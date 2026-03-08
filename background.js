// Background service worker: fetches and parses unjobs.org pages
// to aggregate job listings across duty stations and pages.
// Note: DOMParser is NOT available in service workers, so we use regex parsing.
//
// Grade info is NOT on listing pages — only on individual vacancy detail pages.
// So we do a two-phase approach:
//   Phase 1: Scrape all listing pages to collect job URLs/titles (fast)
//   Phase 2: Fetch each vacancy page in parallel batches to extract grades

const GRADE_PATTERNS = [
  { grade: 'P-1', patterns: [/\bP[\s-]?1\b/i] },
  { grade: 'P-2', patterns: [/\bP[\s-]?2\b/i] },
  { grade: 'P-3', patterns: [/\bP[\s-]?3\b/i] },
  { grade: 'P-4', patterns: [/\bP[\s-]?4\b/i] },
  { grade: 'P-5', patterns: [/\bP[\s-]?5\b/i] },
  { grade: 'D-1', patterns: [/\bD[\s-]?1\b/i] },
  { grade: 'D-2', patterns: [/\bD[\s-]?2\b/i] },
  { grade: 'G-1', patterns: [/\bG[\s-]?1\b/i] },
  { grade: 'G-2', patterns: [/\bG[\s-]?2\b/i] },
  { grade: 'G-3', patterns: [/\bG[\s-]?3\b/i] },
  { grade: 'G-4', patterns: [/\bG[\s-]?4\b/i] },
  { grade: 'G-5', patterns: [/\bG[\s-]?5\b/i] },
  { grade: 'G-6', patterns: [/\bG[\s-]?6\b/i] },
  { grade: 'G-7', patterns: [/\bG[\s-]?7\b/i] },
  { grade: 'NO-A', patterns: [/\bNO[\s-]?A\b/i] },
  { grade: 'NO-B', patterns: [/\bNO[\s-]?B\b/i] },
  { grade: 'NO-C', patterns: [/\bNO[\s-]?C\b/i] },
  { grade: 'NO-D', patterns: [/\bNO[\s-]?D\b/i] },
  { grade: 'NO-E', patterns: [/\bNO[\s-]?E\b/i] },
  { grade: 'UNV', patterns: [/\bUNV\b/, /\bUN\s*Volunteer\b/i] },
  { grade: 'Intern', patterns: [/\bIntern(?:ship)?\b/i] },
  { grade: 'Consultant', patterns: [/\bConsultan(?:t|cy)\b/i, /\bIndividual\s*Contractor\b/i] }
];

function detectGrades(text) {
  const found = [];
  for (const { grade, patterns } of GRADE_PATTERNS) {
    for (const pattern of patterns) {
      if (pattern.test(text)) {
        found.push(grade);
        break;
      }
    }
  }
  return found;
}

function stripHtml(html) {
  return html.replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
}

// ── Phase 1: Parse job listings from a duty station listing page ──

function parseJobsFromHTML(html, dutyStationName) {
  const jobs = [];
  const jtitleRegex = /<a\s[^>]*class="jtitle"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
  const jtitleRegex2 = /<a\s[^>]*href="([^"]*)"[^>]*class="jtitle"[^>]*>([\s\S]*?)<\/a>/gi;

  const matches = [];
  let match;
  while ((match = jtitleRegex.exec(html)) !== null) {
    matches.push({ href: match[1], titleHtml: match[2], index: match.index });
  }
  while ((match = jtitleRegex2.exec(html)) !== null) {
    if (!matches.some(m => m.index === match.index)) {
      matches.push({ href: match[1], titleHtml: match[2], index: match.index });
    }
  }

  for (const m of matches) {
    const title = stripHtml(m.titleHtml);
    const url = m.href.startsWith('http') ? m.href : 'https://unjobs.org' + m.href;

    // Try to detect grade from listing title/snippet (sometimes present)
    const afterLink = html.substring(m.index, m.index + 2000);
    const listingText = stripHtml(afterLink);
    const listingGrades = detectGrades(title + ' ' + listingText);

    // Extract closing date
    const closingMatch = afterLink.match(/Closing date:\s*([^<]+)/);
    const closingDate = closingMatch ? 'Closing date: ' + closingMatch[1].trim() : '';

    // Extract org
    const beforeLink = html.substring(Math.max(0, m.index - 500), m.index);
    let org = '';
    const orgMatch = beforeLink.match(/(?:class="job"[^>]*>)([^<]+)/);
    if (orgMatch) org = orgMatch[1].trim();

    jobs.push({
      title,
      url,
      org,
      grades: listingGrades, // May be empty — will be enriched in Phase 2
      closingDate,
      dutyStation: dutyStationName,
      gradeChecked: listingGrades.length > 0, // Flag: did we already find grade?
    });
  }

  return jobs;
}

// ── Phase 2: Fetch individual vacancy pages to extract grades ──

function extractGradeFromVacancyHTML(html) {
  // Method 1: Structured "Grade:" field — find "Grade:" then the first <a> within 200 chars
  const gradeIdx = html.indexOf('Grade:');
  if (gradeIdx >= 0) {
    const nearbyHtml = html.substring(gradeIdx, gradeIdx + 200);
    const anchorMatch = nearbyHtml.match(/<a[^>]*>([^<]+)<\/a>/);
    if (anchorMatch) {
      return [anchorMatch[1].trim()];
    }
  }

  // Method 2: Detect grade patterns from the page title and body text
  const titleMatch = html.match(/<h[23][^>]*>([\s\S]*?)<\/h[23]>/i);
  const titleText = titleMatch ? stripHtml(titleMatch[1]) : '';
  const bodyText = stripHtml(html.substring(0, 8000));

  return detectGrades(titleText + ' ' + bodyText);
}

async function fetchVacancyGrade(url) {
  try {
    const resp = await fetch(url);
    if (!resp.ok) return [];
    const html = await resp.text();
    return extractGradeFromVacancyHTML(html);
  } catch {
    return [];
  }
}

// Fetch grades for a batch of jobs concurrently
async function enrichJobsWithGrades(jobs, concurrency, sendProgress) {
  const needsCheck = jobs.filter(j => !j.gradeChecked);
  const total = needsCheck.length;
  let completed = 0;

  for (let i = 0; i < needsCheck.length; i += concurrency) {
    const batch = needsCheck.slice(i, i + concurrency);
    const results = await Promise.all(
      batch.map(job => fetchVacancyGrade(job.url))
    );
    for (let j = 0; j < batch.length; j++) {
      batch[j].grades = results[j];
      batch[j].gradeChecked = true;
    }
    completed += batch.length;
    sendProgress(`Checking grades: ${completed}/${total} vacancies...`);
  }
}

// ── Listing page helpers ──

function getTotalFromHTML(html) {
  const match = html.match(/(\d+)\s*-\s*(\d+)\s*of\s*(\d+)/);
  if (match) {
    const perPage = parseInt(match[2]) - parseInt(match[1]) + 1;
    const total = parseInt(match[3]);
    return { total, perPage, pages: Math.ceil(total / perPage) };
  }
  return { total: 0, perPage: 25, pages: 0 };
}

async function fetchPage(url) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`HTTP ${resp.status} for ${url}`);
  return await resp.text();
}

async function fetchDutyStation(station, sendProgress) {
  const baseUrl = station.url;
  const jobs = [];

  const firstPageHtml = await fetchPage(baseUrl);
  const { total, pages } = getTotalFromHTML(firstPageHtml);
  const firstPageJobs = parseJobsFromHTML(firstPageHtml, station.name);
  jobs.push(...firstPageJobs);

  sendProgress(`${station.name}: listing page 1/${pages} (${total} vacancies)`);

  for (let page = 2; page <= pages; page++) {
    const url = `${baseUrl}/${page}`;
    try {
      const html = await fetchPage(url);
      const pageJobs = parseJobsFromHTML(html, station.name);
      jobs.push(...pageJobs);
      sendProgress(`${station.name}: listing page ${page}/${pages}`);
    } catch (err) {
      sendProgress(`${station.name}: error on page ${page} - ${err.message}`);
    }
    await new Promise(r => setTimeout(r, 200));
  }

  return jobs;
}

// ── Message handling ──

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'fetchJobs') {
    handleFetchJobs(msg, sender);
    return false;
  }
  if (msg.type === 'fetchVacancyGrade') {
    fetchVacancyGrade(msg.url).then(grades => sendResponse({ grades }));
    return true;
  }
});

async function handleFetchJobs(msg, sender) {
  let tabId = sender.tab ? sender.tab.id : null;
  if (!tabId) {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const unjobsTab = tabs.find(t => t.url && t.url.includes('unjobs.org'));
    if (unjobsTab) tabId = unjobsTab.id;
  }

  const { dutyStations, selectedGrades } = msg;

  function sendProgress(text) {
    if (tabId) {
      chrome.tabs.sendMessage(tabId, { type: 'fetchProgress', text }).catch(() => {});
    }
  }

  // Phase 1: Collect all job listings
  sendProgress('Phase 1: Collecting job listings...');
  let allJobs = [];

  for (const station of dutyStations) {
    try {
      const jobs = await fetchDutyStation(station, sendProgress);
      allJobs.push(...jobs);
    } catch (err) {
      sendProgress(`Error fetching ${station.name}: ${err.message}`);
    }
  }

  // Deduplicate by URL
  const seen = new Set();
  allJobs = allJobs.filter(job => {
    if (seen.has(job.url)) return false;
    seen.add(job.url);
    return true;
  });

  sendProgress(`Found ${allJobs.length} vacancies. Phase 2: Checking grades (this may take a moment)...`);

  // Phase 2: Fetch individual vacancy pages for grade info
  // Use concurrency of 5 to be respectful but still fast
  await enrichJobsWithGrades(allJobs, 5, sendProgress);

  // Filter by selected grades if any
  let filtered = allJobs;
  if (selectedGrades && selectedGrades.length > 0) {
    filtered = allJobs.filter(job =>
      job.grades.some(g => selectedGrades.includes(g))
    );
  }

  // Sort by closing date (soonest first), jobs without date at the end
  filtered.sort((a, b) => {
    if (!a.closingDate && !b.closingDate) return 0;
    if (!a.closingDate) return 1;
    if (!b.closingDate) return -1;
    return a.closingDate.localeCompare(b.closingDate);
  });

  if (tabId) {
    chrome.tabs.sendMessage(tabId, {
      type: 'fetchResults',
      jobs: filtered,
      totalScanned: allJobs.length,
      stationsScanned: dutyStations.length
    }).catch(() => {});
  }
}
