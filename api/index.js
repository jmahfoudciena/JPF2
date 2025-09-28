const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');
const fetch = require('node-fetch');
const { marked } = require('marked');
const puppeteer = require('puppeteer-core');
const multer = require('multer');
const XLSX = require('xlsx');
require('dotenv').config();

// Configure marked for security and proper rendering
marked.setOptions({
  breaks: true,
  gfm: true,
  sanitize: false,
  headerIds: true,
  mangle: false
});

const app = express();

// Security middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'", "https://cdnjs.cloudflare.com"],
      connectSrc: [
        "'self'",
        "https://api.openai.com",
        "https://www.googleapis.com"
      ],
      imgSrc: ["'self'", "data:", "https:"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      objectSrc: ["'none'"],
      upgradeInsecureRequests: []
    }
  }
}));

// Enable CORS for public access
app.use(cors({
  origin: true,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));

// Parse JSON bodies
app.use(express.json({ limit: '1mb' }));

// Configure multer for file uploads (in-memory for Vercel)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
    files: 1
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel',
      'text/csv'
    ];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only Excel files (.xlsx, .xls) and CSV files are allowed'), false);
    }
  }
});

// Serve static files
app.use(express.static(path.join(__dirname, '../')));

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    version: '1.0.0'
  });
});

// Main route
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../index.html'));
});

// Helper: call Google Custom Search JSON API
async function googleSearch(partNumber) {
  console.log(`[googleSearch] Searching for part: ${partNumber}`);
  const googleKey = process.env.GOOGLE_API_KEY;
  const googleCx = process.env.GOOGLE_CX;
  if (!googleKey || !googleCx) {
    console.error('[googleSearch] Missing GOOGLE_API_KEY or GOOGLE_CX');
    throw new Error('Server is not configured with GOOGLE_API_KEY and GOOGLE_CX');
  }

  const query = `${partNumber} datasheet OR site:digikey.com OR site:mouser.com OR site:arrow.com OR site:avnet.com OR site:ti.com filetype:pdf`;
  const url = `https://www.googleapis.com/customsearch/v1?key=${googleKey}&cx=${googleCx}&num=6&q=${encodeURIComponent(query)}`;

  console.log('[googleSearch] Google API URL:', url);
  const resp = await fetch(url);
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    console.error('[googleSearch] Google Search API error:', resp.status, text);
    throw new Error(`Google Search API error: ${resp.status} ${text}`);
  }
  const data = await resp.json();
  const items = Array.isArray(data.items) ? data.items : [];
  console.log(`[googleSearch] Found ${items.length} items`);
  return items.map(it => ({
    title: it.title,
    link: it.link,
    snippet: it.snippet || ''
  }));
}

// Helper: scrape TI cross-reference tool with Puppeteer
async function scrapeTICrossReference(partNumber) {
  console.log(`[scrapeTICrossReference] Searching TI cross-reference for: ${partNumber}`);
  
  let browser;
  try {
    // Use puppeteer-core with Chrome for Vercel
    browser = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--disable-gpu',
        '--disable-web-security',
        '--disable-features=VizDisplayCompositor',
        '--single-process',
        '--no-zygote'
      ],
      executablePath: process.env.CHROME_BIN || '/usr/bin/google-chrome-stable'
    });
    
    const page = await browser.newPage();
    
    // Set user agent to avoid bot detection
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
    
    // Navigate to TI cross-reference tool
    const tiUrl = `https://www.ti.com/cross-reference-search?singlePart=${partNumber}&p=1`;
    console.log(`[scrapeTICrossReference] Navigating to: ${tiUrl}`);
    
    await page.goto(tiUrl, { 
      waitUntil: 'networkidle0',
      timeout: 30000 
    });
    
    // Wait for cross-reference results to load
    try {
      await page.waitForSelector('a[href*="/product/"]', { 
        timeout: 15000 
      });
      console.log('[scrapeTICrossReference] Cross-reference product links found');
    } catch (error) {
      console.log('[scrapeTICrossReference] No cross-reference results found:', error.message);
      return [];
    }
    
    // Extract alternative part numbers with match type detection
    const alternatives = await page.$$eval('a[href*="/product/"]', elements => {
      return elements
        .filter(el => {
          const text = el.textContent.trim();
          const href = el.href;
          // Filter out non-part links (like "Request samples", navigation, etc.)
          return text && 
                 text.length > 3 && 
                 text.length < 20 && 
                 href.includes('/product/') &&
                 !text.includes('Request') &&
                 !text.includes('samples') &&
                 !text.includes('Close') &&
                 !text.includes('Menu') &&
                 !text.includes('Previous') &&
                 !text.includes('Language') &&
                 !text.includes('My cart') &&
                 !text.includes('Search') &&
                 !text.includes('Home') &&
                 !text.includes('Cross-reference');
        })
        .map(el => {
          // Try to find match type information near this element
          let matchType = 'Cross-Reference Match'; // Default
          
          // Look in parent elements for match type information
          let currentElement = el.parentElement;
          while (currentElement && currentElement !== document.body) {
            const parentText = currentElement.textContent.toLowerCase();
            if (parentText.includes('drop-in replacement') || parentText.includes('drop in replacement')) {
              matchType = 'Drop-in replacement';
              break;
            } else if (parentText.includes('exact match')) {
              matchType = 'Exact Match';
              break;
            } else if (parentText.includes('same functionality')) {
              matchType = 'Same Functionality';
              break;
            } else if (parentText.includes('pin compatible')) {
              matchType = 'Pin Compatible';
              break;
            } else if (parentText.includes('functional equivalent')) {
              matchType = 'Functional Equivalent';
              break;
            } else if (parentText.includes('compatible')) {
              matchType = 'Compatible';
              break;
            } else if (parentText.includes('replacement')) {
              matchType = 'Replacement';
              break;
            }
            currentElement = currentElement.parentElement;
          }
          
          return {
            partNumber: el.textContent.trim(),
            matchType: matchType,
            href: el.href,
            title: el.title || el.textContent.trim()
          };
        });
    });
    
    console.log(`[scrapeTICrossReference] Found ${alternatives.length} TI alternatives:`, alternatives.map(a => a.partNumber));
    return alternatives;
    
  } catch (error) {
    console.error('[scrapeTICrossReference] Error:', error.message);
    return [];
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

// Part alternatives API
app.post('/api/alternatives', async (req, res) => {
  try {
    console.log('[POST /api/alternatives] Request body:', req.body);
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      console.error('[POST /api/alternatives] Missing OPENAI_API_KEY');
      return res.status(500).json({ error: 'Server is not configured with OPENAI_API_KEY' });
    }

    const { partNumber } = req.body || {};
    if (!partNumber) {
      console.warn('[POST /api/alternatives] Missing partNumber');
      return res.status(400).json({ error: 'Part number is required' });
    }

    // Google search first
    let searchItems = [];
    let searchSummary = 'No search results found.';
    try {
      searchItems = await googleSearch(partNumber);
      console.log('[POST /api/alternatives] Search results:', searchItems.map(s => s.link));
      if (searchItems.length) {
        searchSummary = searchItems
          .slice(0, 6)
          .map((r, i) => `${i + 1}. ${r.title}\nURL: ${r.link}\n${r.snippet}`)
          .join('\n\n');
      }
    } catch (e) {
      console.warn('Google search failed, continuing without results:', e.message);
    }

    // TI cross-reference search
    let tiAlternatives = [];
    let tiSummary = 'No TI cross-reference results found.';
    try {
      tiAlternatives = await scrapeTICrossReference(partNumber);
      console.log('[POST /api/alternatives] TI alternatives:', tiAlternatives.map(t => t.partNumber));
      if (tiAlternatives.length) {
        tiSummary = `TI Cross-Reference Alternatives Found:\n${tiAlternatives
          .map((alt, i) => `${i + 1}. ${alt.partNumber} - ${alt.title}\nURL: ${alt.href}`)
          .join('\n\n')}`;
      }
    } catch (e) {
      console.warn('TI cross-reference search failed, continuing without results:', e.message);
    }

    // Build the prompt
    const userPrompt = `I need to find 3 alternative components for the electronic part number: ${partNumber}.
Use the following web search results as context: ${searchSummary}

TI Cross-Reference Results: ${tiSummary}

Please provide exactly 3 alternatives in this format:
1. [Part Number] - [Brief Description] - [Manufacturer]
2. [Part Number] - [Brief Description] - [Manufacturer]  
3. [Part Number] - [Brief Description] - [Manufacturer]

Focus on:
- Different manufacturers than the original
- Package compatibility
- Functional equivalence
- Current availability`;

    console.log('[POST /api/alternatives] Prompt sent to OpenAI:', userPrompt);
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [
          {
            role: 'system',
            content: 'You are a helpful electronics engineer. Provide exactly 3 alternatives in the specified format. Be concise and accurate.'
          },
          { role: 'user', content: userPrompt }
        ],
        max_tokens: 2000,
        temperature: 0.3
      })
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(`API Error: ${errorData.error?.message || response.statusText}`);
    }

    const data = await response.json();
    const markdownContent = data.choices[0].message.content;
    const htmlContent = marked(markdownContent)
      .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '');

    return res.json({
      alternatives: htmlContent,
      raw: markdownContent,
      searchResults: searchItems,
      tiAlternatives: tiAlternatives
    });
  } catch (error) {
    console.error('[POST /api/alternatives] Error:', error);
    return res.status(500).json({ error: error.message || 'Server error' });
  }
});

// Compare API
app.post('/api/compare', async (req, res) => {
  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: 'Server is not configured with OPENAI_API_KEY' });
    }

    const { partA, partB } = req.body || {};
    if (!partA || !partB) {
      return res.status(400).json({ error: 'Both partA and partB are required' });
    }

    const systemPrompt = 'You are an expert electronics engineer and component librarian specializing in detailed component analysis.';

    const userPrompt = `Compare these two electronic components: "${partA}" vs "${partB}".

Provide a comprehensive analysis including:

1. **OVERVIEW TABLE** - Create a markdown table with these columns:
   - Specification Category
   - ${partA} Value
   - ${partB} Value
   - Difference (highlight in bold if significant)
   - Impact Assessment

2. **ELECTRICAL SPECIFICATIONS** - Create a markdown table with these columns:
   - Specification
   - ${partA} Value
   - ${partB} Value
   Include: Voltage ranges, Current ratings, Power dissipation, Frequency/speed specifications

3. **PACKAGE & FOOTPRINT** - Create a markdown table with these columns:
   - Physical Characteristic
   - ${partA} Specification
   - ${partB} Specification
   Include: Package dimensions, Pin count, Mounting requirements, Operating temperature range

4. **DROP-IN COMPATIBILITY ASSESSMENT**:
   - Overall compatibility score (0-100%)
   - Specific reasons for incompatibility
   - Required modifications for replacement
   - Risk assessment

5. **RECOMMENDATIONS**:
   - When to use each part
   - Migration strategies
   - Alternative suggestions

Format the response in clean markdown with proper tables and ensure all differences are clearly highlighted.`;

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        max_tokens: 16384,
        temperature: 0.2
      })
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      return res.status(response.status).json({ error: err.error?.message || 'OpenAI API error' });
    }

    const data = await response.json();
    const markdownContent = data?.choices?.[0]?.message?.content || '';
    if (!markdownContent) {
      return res.status(502).json({ error: 'Empty response from model' });
    }

    const htmlContent = marked(markdownContent)
      .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '')
      .replace(/<table/g, '<table class="comparison-table"')
      .replace(/<tr/g, '<tr class="comparison-row"')
      .replace(/<td/g, '<td class="comparison-cell"')
      .replace(/<th/g, '<th class="comparison-header"');

    return res.json({ html: htmlContent });
  } catch (error) {
    console.error('[POST /api/compare] Error:', error);
    return res.status(500).json({ error: error.message || 'Server error' });
  }
});

// Bulk processing endpoints
app.post('/api/bulk-upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    console.log('[POST /api/bulk-upload] Processing file:', req.file.originalname);
    
    // Read and parse the Excel file from memory buffer
    const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

    // Extract part numbers from the first column
    const partNumbers = jsonData
      .map(row => row[0])
      .filter(part => part && typeof part === 'string' && part.trim().length > 0)
      .map(part => part.trim())
      .slice(0, 10); // Limit to 10 parts

    if (partNumbers.length === 0) {
      return res.status(400).json({ error: 'No valid part numbers found in the file' });
    }

    if (partNumbers.length > 10) {
      return res.status(400).json({ error: 'Maximum 10 part numbers allowed' });
    }

    console.log('[POST /api/bulk-upload] Found part numbers:', partNumbers);

    res.json({
      success: true,
      partNumbers: partNumbers,
      count: partNumbers.length
    });

  } catch (error) {
    console.error('[POST /api/bulk-upload] Error:', error);
    res.status(500).json({ error: error.message || 'Failed to process file' });
  }
});

app.post('/api/bulk-process', async (req, res) => {
  try {
    const { partNumbers } = req.body;
    
    if (!partNumbers || !Array.isArray(partNumbers) || partNumbers.length === 0) {
      return res.status(400).json({ error: 'Part numbers array is required' });
    }

    if (partNumbers.length > 10) {
      return res.status(400).json({ error: 'Maximum 10 part numbers allowed' });
    }

    console.log('[POST /api/bulk-process] Processing parts:', partNumbers);

    const results = [];
    const errors = [];

    // Process each part number
    for (let i = 0; i < partNumbers.length; i++) {
      const partNumber = partNumbers[i];
      console.log(`[POST /api/bulk-process] Processing ${i + 1}/${partNumbers.length}: ${partNumber}`);
      
      try {
        // Get TI alternatives
        let tiAlternatives = [];
        try {
          tiAlternatives = await scrapeTICrossReference(partNumber);
        } catch (tiError) {
          console.warn(`[POST /api/bulk-process] TI search failed for ${partNumber}:`, tiError.message);
        }

        // Get Google search results
        let searchItems = [];
        try {
          searchItems = await googleSearch(partNumber);
        } catch (searchError) {
          console.warn(`[POST /api/bulk-process] Google search failed for ${partNumber}:`, searchError.message);
        }

        // Get AI alternatives
        let aiAlternatives = [];
        try {
          const searchSummary = searchItems.length > 0 
            ? searchItems.slice(0, 6).map((r, i) => `${i + 1}. ${r.title}\nURL: ${r.link}\n${r.snippet}`).join('\n\n')
            : 'No search results found.';

          const tiSummary = tiAlternatives.length > 0
            ? `TI Cross-Reference Alternatives Found:\n${tiAlternatives.map((alt, i) => `${i + 1}. ${alt.partNumber} - ${alt.title}\nURL: ${alt.href}`).join('\n\n')}`
            : 'No TI cross-reference results found.';

          const userPrompt = `I need to find 3 alternative components for the electronic part number: ${partNumber}.
Use the following web search results as context: ${searchSummary}

TI Cross-Reference Results: ${tiSummary}

Please provide exactly 3 alternatives in this format:
1. [Part Number] - [Brief Description] - [Manufacturer]
2. [Part Number] - [Brief Description] - [Manufacturer]  
3. [Part Number] - [Brief Description] - [Manufacturer]

Focus on:
- Different manufacturers than the original
- Package compatibility
- Functional equivalence
- Current availability`;

          const response = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
            },
            body: JSON.stringify({
              model: 'gpt-4o',
              messages: [
                {
                  role: 'system',
                  content: 'You are a helpful electronics engineer. Provide exactly 3 alternatives in the specified format. Be concise and accurate.'
                },
                { role: 'user', content: userPrompt }
              ],
              max_tokens: 2000,
              temperature: 0.3
            })
          });

          if (response.ok) {
            const data = await response.json();
            const content = data.choices[0].message.content;
            
            // Parse AI alternatives from response
            const lines = content.split('\n').filter(line => line.trim());
            aiAlternatives = lines
              .filter(line => /^\d+\.\s+[A-Z0-9]/.test(line.trim()))
              .map(line => {
                const match = line.match(/^\d+\.\s+([A-Z0-9\-\.\/]+)\s*-\s*(.+?)\s*-\s*(.+)$/);
                if (match) {
                  return {
                    partNumber: match[1].trim(),
                    description: match[2].trim(),
                    manufacturer: match[3].trim()
                  };
                }
                return null;
              })
              .filter(alt => alt !== null)
              .slice(0, 3);
          }
        } catch (aiError) {
          console.warn(`[POST /api/bulk-process] AI analysis failed for ${partNumber}:`, aiError.message);
        }

        results.push({
          originalPart: partNumber,
          tiAlternatives: tiAlternatives.slice(0, 1), // Take first TI alternative
          aiAlternatives: aiAlternatives.slice(0, 3), // Take up to 3 AI alternatives
          status: 'success'
        });

      } catch (error) {
        console.error(`[POST /api/bulk-process] Error processing ${partNumber}:`, error);
        errors.push({
          partNumber: partNumber,
          error: error.message
        });
        
        results.push({
          originalPart: partNumber,
          tiAlternatives: [],
          aiAlternatives: [],
          status: 'error',
          error: error.message
        });
      }
    }

    console.log('[POST /api/bulk-process] Processing complete. Results:', results.length, 'Errors:', errors.length);

    res.json({
      success: true,
      results: results,
      errors: errors,
      totalProcessed: results.length,
      successCount: results.filter(r => r.status === 'success').length,
      errorCount: errors.length
    });

  } catch (error) {
    console.error('[POST /api/bulk-process] Error:', error);
    res.status(500).json({ error: error.message || 'Bulk processing failed' });
  }
});

app.get('/api/bulk-export/:format', async (req, res) => {
  try {
    const { format } = req.params;
    const { results } = req.query;
    
    if (!results) {
      return res.status(400).json({ error: 'Results data is required' });
    }

    const parsedResults = JSON.parse(decodeURIComponent(results));
    
    if (format === 'excel') {
      // Create Excel workbook
      const workbook = XLSX.utils.book_new();
      
      // Prepare data for Excel
      const excelData = [
        ['Original Part', 'TI Cross-Reference Alternative', 'Match Type', 'AI Alternative 1', 'AI Alternative 2', 'AI Alternative 3', 'Status']
      ];

      parsedResults.forEach(result => {
        const row = [
          result.originalPart,
          result.tiAlternatives.length > 0 ? result.tiAlternatives[0].partNumber : 'N/A',
          result.tiAlternatives.length > 0 ? (result.tiAlternatives[0].matchType || 'Cross-Reference Match') : 'N/A',
          result.aiAlternatives.length > 0 ? result.aiAlternatives[0].partNumber : 'N/A',
          result.aiAlternatives.length > 1 ? result.aiAlternatives[1].partNumber : 'N/A',
          result.aiAlternatives.length > 2 ? result.aiAlternatives[2].partNumber : 'N/A',
          result.status
        ];
        excelData.push(row);
      });

      const worksheet = XLSX.utils.aoa_to_sheet(excelData);
      
      // Style the header row
      const range = XLSX.utils.decode_range(worksheet['!ref']);
      for (let col = range.s.c; col <= range.e.c; col++) {
        const cellAddress = XLSX.utils.encode_cell({ r: 0, c: col });
        if (!worksheet[cellAddress]) continue;
        worksheet[cellAddress].s = {
          font: { bold: true },
          fill: { fgColor: { rgb: "FFE6E6" } }
        };
      }

      XLSX.utils.book_append_sheet(workbook, worksheet, 'Part Alternatives');
      
      // Generate Excel buffer
      const excelBuffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
      
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', 'attachment; filename="part-alternatives-bulk.xlsx"');
      res.send(excelBuffer);
      
    } else {
      return res.status(400).json({ error: 'Unsupported format. Use "excel".' });
    }

  } catch (error) {
    console.error('[GET /api/bulk-export] Error:', error);
    res.status(500).json({ error: error.message || 'Export failed' });
  }
});

// Error handling middleware
app.use((error, req, res, next) => {
  console.error('Error:', error);
  
  if (error.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({ 
      error: 'File too large. Maximum size is 5MB.' 
    });
  }
  
  if (error.code === 'LIMIT_UNEXPECTED_FILE') {
    return res.status(400).json({ 
      error: 'Unexpected file field.' 
    });
  }
  
  res.status(500).json({ 
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'production' ? 'Something went wrong' : error.message
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ 
    error: 'Not found',
    message: 'The requested resource was not found'
  });
});

// Export the app for Vercel
module.exports = app;