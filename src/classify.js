// Rule-based bucketing + fallback summary/skills (used when no AI key is set,
// and as a sanity check on AI output).

const RX = {
  freshersTitle: /\b(fresher|freshers|trainee|intern|internship|graduate|campus|apprentice|entry[- ]level|junior|jr\.?)\b/i,
  freshersJD: /\b(0\s*[-–to]+\s*[12]\s*(years?|yrs?)|freshers? (can|may) apply|no experience required|recent graduates?|batch of 20\d\d|20(2[4-7]) (pass[- ]?outs?|graduates?))\b/i,
  management:
    /\b(manager|director|head of|head,|vp|vice president|scrum master|agile coach|program(me)? lead|delivery lead|product owner|cto|cio|chief technology|chief information|practice lead)\b/i,
  ai: /\b(a\.?i\.?|ml|machine learning|deep learning|llm|llms|gen ?ai|generative|nlp|computer vision|data scien\w*|forward[- ]deployed|fde|mlops|applied scientist|research scientist|prompt engineer|agentic)\b/i,
  dev: /\b(software|developer|engineer|sde|programmer|full[- ]?stack|front[- ]?end|back[- ]?end|qa|quality assurance|test(ing|er)?|sdet|automation|cloud|devops|sre|site reliability|platform|aws|azure|gcp|kubernetes|java|python|\.net|react|node|android|ios|mobile|data engineer|architect|salesforce|sap|security)\b/i,
  notIT:
    /\b(sales executive|telecaller|nurse|teacher|accountant|driver|warehouse|civil engineer|mechanical engineer|electrical engineer|chemical|pharma|medical representative|hr executive|recruiter|chef|beautician)\b/i,
};

const SKILLS = [
  'Python', 'Java', 'JavaScript', 'TypeScript', 'Go', 'Golang', 'Rust', 'C#', 'C++', '.NET', 'Kotlin', 'Swift', 'Scala', 'PHP', 'Ruby',
  'React', 'Angular', 'Vue', 'Next.js', 'Node.js', 'Spring Boot', 'Django', 'FastAPI', 'Flask',
  'SQL', 'PostgreSQL', 'MySQL', 'MongoDB', 'Redis', 'Kafka', 'Spark', 'Databricks', 'Snowflake', 'Airflow',
  'AWS', 'Azure', 'GCP', 'Docker', 'Kubernetes', 'Terraform', 'Jenkins', 'GitHub Actions', 'CI/CD', 'Linux', 'Microservices', 'REST APIs', 'GraphQL',
  'Selenium', 'Cypress', 'Playwright', 'Appium', 'JMeter', 'Postman', 'Test Automation',
  'Machine Learning', 'Deep Learning', 'PyTorch', 'TensorFlow', 'scikit-learn', 'NLP', 'Computer Vision', 'LLMs', 'Generative AI', 'RAG',
  'LangChain', 'LangGraph', 'Hugging Face', 'Vector Databases', 'MLOps', 'Prompt Engineering', 'Agentic AI',
  'Agile', 'Scrum', 'Jira', 'Stakeholder Management', 'Roadmapping', 'Budgeting', 'People Management', 'Product Strategy',
  'Data Structures', 'Algorithms', 'OOP', 'Git', 'HTML', 'CSS', 'Salesforce', 'SAP', 'Power BI', 'Tableau',
];

function bucketFor(job) {
  const title = job.position || '';
  const jd = job.description || '';
  if (RX.notIT.test(title)) return null;
  const seniority = (job.seniority || '').toLowerCase();
  if (RX.freshersTitle.test(title) || seniority === 'internship' || seniority === 'entry level' || RX.freshersJD.test(jd)) {
    // entry-level but clearly a manager title -> still management
    if (!RX.management.test(title)) return 'freshers';
  }
  if (RX.management.test(title) && !/\b(engineer|developer)\b/i.test(title.replace(/engineering manager/i, ''))) return 'management';
  if (RX.ai.test(title)) return 'ai';
  if (RX.dev.test(title)) return 'dev';
  return null;
}

function extractSkills(text, max = 5, title = '') {
  // Rank by how often a skill appears in the JD; skills in the title count extra
  const scored = [];
  for (const s of SKILLS) {
    const esc = s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const rx = new RegExp(`(^|[^A-Za-z0-9])${esc}(?=[^A-Za-z0-9]|$)`, s.length <= 3 ? 'g' : 'gi');
    const hits = (text.match(rx) || []).length + (title.match(rx) || []).length * 3;
    if (hits) scored.push([s, hits]);
  }
  return scored.sort((a, b) => b[1] - a[1]).slice(0, max).map(([s]) => s);
}

function fallbackSummary(job) {
  // Skip intro boilerplate only when a section heading sits on its own line
  const text = (job.description || '').replace(/^[\s\S]*?(?:^|\n)\s*(?:about the role|role overview|job summary|job description|key responsibilities|responsibilities)\s*:?\s*\n/i, '');
  const sentences = text
    .split(/\n|(?<=[.!?])\s+/)
    .map((s) => s.replace(/^[•\-*\s]+/, '').replace(/\.{2,}$/, '.').trim())
    .filter((s) => s.length > 40 && !/^(title|location|experience|company|job title|position)\s*:/i.test(s))
    .map((s) => (/[.!?]$/.test(s) ? s : s + '.'))
    .map((s) => s[0].toUpperCase() + s.slice(1));
  let out = sentences.slice(0, 2).join(' ');
  if (out.length > 200) out = out.slice(0, 197).replace(/\s+\S*$/, '') + '…';
  return out || `${job.position} role at ${job.company}.`;
}

function fallbackExperience(job) {
  const m = (job.description || '').match(/(\d{1,2})\s*(\+|[-–to]+\s*\d{1,2})?\s*(years?|yrs?)/i);
  return m ? m[0].replace(/\s+/g, ' ') : '';
}

module.exports = { RX, bucketFor, extractSkills, fallbackSummary, fallbackExperience };
