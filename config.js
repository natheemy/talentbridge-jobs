// Central configuration. Most values can be overridden with environment variables.
require('dotenv').config();

const env = (k, d) => (process.env[k] !== undefined && process.env[k] !== '' ? process.env[k] : d);

module.exports = {
  brand: {
    name: env('BRAND_NAME', 'Talent Bridge'),
    handle: env('BRAND_HANDLE', 'Follow TalentBridge for more opportunities'),
    hashtags: env('BRAND_HASHTAGS', '#TalentBridge #hiring #ITjobs #jobs #India').split(/\s+/).filter(Boolean),
    tagline: env('BRAND_TAGLINE', 'Connecting talent with opportunity'),
    // Optional logo file (png/jpg/svg). If set, it replaces the text wordmark.
    logo: env('BRAND_LOGO', ''),
    // Short lines on the image; separate with |
    valuesLines: env('BRAND_VALUES', 'People|Opportunities|Brighter tomorrows').split('|'),
    scriptLines: env('BRAND_SCRIPT', 'Your|next opportunity|awaits').split('|'),
    footerLines: env('BRAND_FOOTER', 'More opportunities|a brighter future').split('|'),
  },

  render: {
    showSummary: env('SHOW_SUMMARY', 'true') === 'true',
    showSkills: env('SHOW_SKILLS', 'true') === 'true',
  },

  search: {
    location: env('JOB_LOCATION', 'India'),
    // LinkedIn f_TPR: r86400 = last 24 hours
    timeRange: 'r86400',
    pagesPerQuery: Number(env('PAGES_PER_QUERY', 2)), // 10 results per page
    requestDelayMs: Number(env('REQUEST_DELAY_MS', 1500)),
  },

  // Max jobs shown per bucket image (5 fits the 1080x1350 layout cleanly)
  jobsPerBucket: Number(env('JOBS_PER_BUCKET', 5)),
  // Only one job per company per bucket, to keep the list varied
  onePerCompany: env('ONE_PER_COMPANY', 'true') === 'true',

  // LinkedIn experience filter codes (f_E): 1 internship, 2 entry, 3 associate, 4 mid-senior, 5 director, 6 executive
  buckets: [
    {
      id: 'freshers',
      title: 'Freshers',
      subtitle: 'entry-level and internship IT',
      color: '#F4B400',
      ink: '#15181E',
      queries: [
        { keyword: 'software engineer fresher', experience: '1,2' },
        { keyword: 'graduate engineer trainee IT', experience: '1,2' },
        { keyword: 'software developer intern', experience: '1' },
        { keyword: 'associate software engineer', experience: '2' },
      ],
    },
    {
      id: 'management',
      title: 'Management',
      subtitle: 'engineering, product and delivery leadership',
      color: '#1D2B53',
      ink: '#FFFFFF',
      queries: [
        { keyword: 'engineering manager', experience: '4,5,6' },
        { keyword: 'IT project manager', experience: '4,5' },
        { keyword: 'technical program manager', experience: '4,5' },
        { keyword: 'delivery manager software', experience: '4,5' },
        { keyword: 'product manager software', experience: '4,5' },
      ],
    },
    {
      id: 'dev',
      title: 'Dev, Test & Cloud',
      subtitle: 'software development, testing, cloud and DevOps',
      color: '#0E6B5C',
      ink: '#FFFFFF',
      queries: [
        { keyword: 'software engineer', experience: '3,4' },
        { keyword: 'full stack developer', experience: '3,4' },
        { keyword: 'QA automation engineer', experience: '3,4' },
        { keyword: 'cloud engineer AWS Azure', experience: '3,4' },
        { keyword: 'devops engineer', experience: '3,4' },
      ],
    },
    {
      id: 'ai',
      title: 'AI, ML & FDE',
      subtitle: 'AI engineering, machine learning and forward deployed engineering',
      color: '#4B2FA8',
      ink: '#FFFFFF',
      queries: [
        { keyword: 'machine learning engineer', experience: '2,3,4' },
        { keyword: 'AI engineer generative AI LLM', experience: '2,3,4' },
        { keyword: 'forward deployed engineer', experience: '' },
        { keyword: 'data scientist', experience: '3,4' },
        { keyword: 'MLOps engineer', experience: '3,4' },
      ],
    },
  ],

  // How jobs are scored inside each bucket (see src/rank.js). Weights add up to 100.
  ranking: {
    weights: { employer: 25, quality: 20, freshness: 15, competition: 15, roleFit: 15, location: 10 },
    candidatesPerBucket: Number(env('CANDIDATES_PER_BUCKET', 20)), // JDs fetched per bucket before final ranking
    minDescriptionChars: 300,
    minAiQuality: 4, // AI rates each post 1-10; below this it's dropped
    maxPerCity: 3,
    // Employers that get the top "employer" score. Add or remove freely.
    topEmployers: [
      'TCS', 'Tata Consultancy Services', 'Infosys', 'Wipro', 'HCLTech', 'HCL Technologies', 'Tech Mahindra', 'LTIMindtree', 'Mphasis',
      'Persistent Systems', 'Coforge', 'Hexaware', 'Zensar', 'Cyient', 'KPIT', 'Tata Elxsi', 'UST', 'Virtusa', 'EPAM', 'Sonata Software',
      'Accenture', 'Cognizant', 'Capgemini', 'IBM', 'Deloitte', 'EY', 'KPMG', 'PwC', 'Thoughtworks', 'Publicis Sapient', 'NTT DATA', 'DXC Technology',
      'Microsoft', 'Google', 'Amazon', 'AWS', 'Apple', 'Meta', 'Oracle', 'SAP', 'Salesforce', 'Adobe', 'Cisco', 'Intel', 'NVIDIA', 'Qualcomm',
      'IBM', 'Dell Technologies', 'HP', 'Broadcom', 'ServiceNow', 'Atlassian', 'Intuit', 'PayPal', 'Visa', 'Mastercard', 'American Express',
      'Walmart Global Tech', 'Target', 'Lowe\'s', 'Uber', 'LinkedIn', 'Siemens', 'Bosch', 'Honeywell', 'Philips', 'GE HealthCare', 'Shell',
      'Goldman Sachs', 'J.P. Morgan', 'JPMorgan Chase', 'Morgan Stanley', 'Barclays', 'HSBC', 'Citi', 'Wells Fargo', 'Deutsche Bank',
      'Zoho', 'Freshworks', 'Flipkart', 'PhonePe', 'Paytm', 'Razorpay', 'Swiggy', 'Zomato', 'Meesho', 'CRED', 'Myntra', 'Ola',
      'Samsung', 'Nokia', 'Ericsson', 'Juniper Networks',
    ],
  },

  // AI for summaries/skills/quality. Set ONE key. If both are set, AI_PROVIDER picks (default: gemini).
  ai: {
    provider: env('AI_PROVIDER', ''), // 'gemini' | 'anthropic' | '' (auto)
    apiKey: env('ANTHROPIC_API_KEY', ''),
    model: env('ANTHROPIC_MODEL', 'claude-haiku-5-5'),
    geminiApiKey: env('GEMINI_API_KEY', ''),
    geminiModel: env('GEMINI_MODEL', 'gemini-3.5-flash-lite'),
    concurrency: Number(env('AI_CONCURRENCY', 4)),
  },

  linkedin: {
    accessToken: env('LINKEDIN_ACCESS_TOKEN', ''),
    // Company page URN, e.g. urn:li:organization:12345678
    organizationUrn: env('LINKEDIN_ORG_URN', ''),
    apiVersion: env('LINKEDIN_API_VERSION', '202509'),
  },

  telegram: {
    botToken: env('TELEGRAM_BOT_TOKEN', ''),
    chatId: env('TELEGRAM_CHAT_ID', ''),
  },

  outDir: env('OUT_DIR', 'out'),
  stateFile: env('STATE_FILE', 'data/posted.json'),
  timezone: 'Asia/Kolkata',
};
