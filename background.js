// Background service worker: fetches and parses unjobs.org pages
// to aggregate job listings across duty stations and pages.
// Note: DOMParser is NOT available in service workers, so we use regex parsing.

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

// Strip HTML tags to get plain text
function stripHtml(html) {
  return html.replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
}

// Parse job listings from HTML using regex (no DOMParser in service workers)
function parseJobsFromHTML(html, dutyStationName) {
  const jobs = [];

  // Each job is in a <div class="job"> ... </div> (may have nested divs for org wrapper)
  // The structure on listing pages:
  //   <div class="job">
  //     <a class="jtitle" href="/vacancies/...">Title</a>
  //     <br><span>snippet...</span>
  //     <br><br><time ...>...</time><br><span>Closing date: ...</span>
  //   </div>
  // But the .job div is sometimes wrapped in an org div.

  // Strategy: find all <a class="jtitle" elements and extract data around them
  const jtitleRegex = /<a\s+class="jtitle"\s+href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
  let match;

  while ((match = jtitleRegex.exec(html)) !== null) {
    const href = match[1];
    const title = stripHtml(match[2]);
    const url = href.startsWith('http') ? href : 'https://unjobs.org' + href;

    // Get surrounding context (up to 2000 chars after the link) for org, grade, closing date
    const afterLink = html.substring(match.index, match.index + 3000);
    const fullText = stripHtml(afterLink);

    // Extract org: look for text before the jtitle link in the parent div
    // The org is typically in the parent .job div's wrapper, before "Updated:"
    const beforeLink = html.substring(Math.max(0, match.index - 500), match.index);
    let org = '';
    // Org text is usually right before the <a class="jtitle"> in the parent container
    // Pattern: org name appears in text, often followed by "Updated:"
    const orgMatch = beforeLink.match(/(?:class="job"[^>]*>)([^<]+)/);
    if (orgMatch) {
      org = orgMatch[1].trim();
    }

    // Extract closing date
    const closingMatch = afterLink.match(/Closing date:\s*([^<]+)/);
    const closingDate = closingMatch ? 'Closing date: ' + closingMatch[1].trim() : '';

    const grades = detectGrades(fullText);

    jobs.push({
      title,
      url,
      org,
      grades,
      closingDate,
      dutyStation: dutyStationName,
    });
  }

  return jobs;
}

// Get total pages from HTML
function getTotalFromHTML(html) {
  const match = html.match(/(\d+)\s*-\s*(\d+)\s*of\s*(\d+)/);
  if (match) {
    const perPage = parseInt(match[2]) - parseInt(match[1]) + 1;
    const total = parseInt(match[3]);
    return { total, perPage, pages: Math.ceil(total / perPage) };
  }
  return { total: 0, perPage: 25, pages: 0 };
}

// Fetch a single page
async function fetchPage(url) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`HTTP ${resp.status} for ${url}`);
  return await resp.text();
}

// Fetch all jobs for a duty station
async function fetchDutyStation(station, sendProgress) {
  const baseUrl = station.url;
  const jobs = [];

  const firstPageHtml = await fetchPage(baseUrl);
  const { total, pages } = getTotalFromHTML(firstPageHtml);
  const firstPageJobs = parseJobsFromHTML(firstPageHtml, station.name);
  jobs.push(...firstPageJobs);

  sendProgress(`${station.name}: page 1/${pages} (${total} total vacancies)`);

  for (let page = 2; page <= pages; page++) {
    const url = `${baseUrl}/${page}`;
    try {
      const html = await fetchPage(url);
      const pageJobs = parseJobsFromHTML(html, station.name);
      jobs.push(...pageJobs);
      sendProgress(`${station.name}: page ${page}/${pages}`);
    } catch (err) {
      sendProgress(`${station.name}: error on page ${page} - ${err.message}`);
    }
    // Small delay between requests
    await new Promise(r => setTimeout(r, 300));
  }

  return jobs;
}

// Handle messages from content script / popup
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'fetchJobs') {
    handleFetchJobs(msg, sender);
    return false;
  }
  if (msg.type === 'fetchVacancyGrade') {
    handleFetchVacancyGrade(msg).then(sendResponse);
    return true;
  }
});

async function handleFetchVacancyGrade(msg) {
  try {
    const html = await fetchPage(msg.url);
    // Look for structured grade field via regex
    const gradeFieldMatch = html.match(/Grade:<\/[^>]+>\s*<[^>]*>\s*<a[^>]*>([^<]+)<\/a>/i);
    if (gradeFieldMatch) {
      return { grade: gradeFieldMatch[1].trim() };
    }
    // Fallback: detect from full page text
    const plainText = stripHtml(html);
    const grades = detectGrades(plainText);
    return { grade: grades.length > 0 ? grades[0] : null };
  } catch (err) {
    return { grade: null, error: err.message };
  }
}

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
