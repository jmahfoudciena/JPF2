const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');
const fetch = require('node-fetch');
const { marked } = require('marked');
const puppeteer = require('puppeteer');
const multer = require('multer');
const XLSX = require('xlsx');
require('dotenv').config();

// Configure marked for security and proper rendering
marked.setOptions({
  breaks: true, // Convert line breaks to <br>
  gfm: true, // GitHub Flavored Markdown
  sanitize: false, // We'll handle sanitization ourselves
  headerIds: true,
  mangle: false
});

const app = express();
const PORT = process.env.PORT || 3000;

// Security middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      connectSrc: [
        "'self'",
        "https://api.openai.com",
        "https://www.googleapis.com" // allow Google Custom Search API
      ]
    }
  }
}));

// Enable CORS for company network access
app.use(cors({
  origin: true,
  credentials: true
}));

// Parse JSON bodies
app.use(express.json({ limit: '1mb' }));

// Configure multer for file uploads
const upload = multer({
  dest: 'uploads/',
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
    files: 1
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
      'application/vnd.ms-excel', // .xls
      'text/csv' // .csv
    ];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only Excel files (.xlsx, .xls) and CSV files are allowed'), false);
    }
  }
});

// Serve static files (HTML, CSS, JS)
app.use(express.static(path.join(__dirname)));

// Main route
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Test TI cross-reference endpoint
app.get('/test-ti/:partNumber', async (req, res) => {
  try {
    const { partNumber } = req.params;
    console.log(`[TEST] Testing TI cross-reference for: ${partNumber}`);
    
    const alternatives = await scrapeTICrossReference(partNumber);
    
    res.json({
      partNumber,
      alternatives,
      count: alternatives.length,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('[TEST] Error:', error);
    res.status(500).json({ 
      error: error.message,
      partNumber: req.params.partNumber 
    });
  }
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

  // Bias towards datasheets and authorized distributors
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

// Helper: scrape TI cross-reference tool
async function scrapeTICrossReference(partNumber) {
  console.log(`[scrapeTICrossReference] Searching TI cross-reference for: ${partNumber}`);
  
  let browser;
  try {
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
        '--disable-features=VizDisplayCompositor'
      ]
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

// Part alternatives API — now grounded with Google results first
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

    // 1) Google search first (with graceful fallback)
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
      // Fallback to continue without web context
      console.warn('Google search failed, continuing without results:', e.message);
    }

    // 2) TI cross-reference search (with graceful fallback)
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
      // Fallback to continue without TI results
      console.warn('TI cross-reference search failed, continuing without results:', e.message);
    }

    // 3) Build the prompt (prepend web context, then your original strict spec)
    const userPrompt = `I need to find 3 alternative components for the electronic part number: ${partNumber}.
	Use the following web search results as context for the original part only:${searchSummary}
	
	TI Cross-Reference Results:${tiSummary}
 	
  Follow these requirements carefully:
1. Original Part Verification
• Short Description: Provide a concise summary of the original component’s function and key specifications Using the following web search results as context for the original part only:${searchSummary}
• Package Type Verification Using the following web search results as context for the original part only:${searchSummary}:
 No assumptions.
  - Consistency Rules:
    - Do not assume family parts share the same package; only confirm from “Package / Case” AND “Supplier Device Package”.
    - Do not invent, infer, or guess.
• Core Electrical Specs: Verify voltage, current, frequency, timing, and power from the datasheet. Using the following web search results as context for the original part only:${searchSummary}.
• Pinout Verification: Confirm pinout from datasheet Using the following web search results as context for the original part only:${searchSummary}.
• Block Diagram Summary: Analyze internal functional blocks (e.g., PLL, MUX, Buffers, ADC, interfaces). Using the following web search results as context for the original part only:${searchSummary}.
• Price & Lifecycle: Provide current unit price from Digi-Key or Mouser. Confirm lifecycle status (Active, NRND, Last Time Buy) Using the following web search results as context for the original part only:${searchSummary}.
2. Alternatives Search. Use short description, functionality and package of the original part to search for altnernate parts.
• Identify 3 Alternatives:
  - From reputable manufacturers (e.g., TI, ADI, NXP, ON Semi, Microchip)
  - Alternate part must not be from the same manufacturer as the original part. **important**
  - Prioritize parts that are functionally equivalent and package-compatible
• Industry-Preferred Equivalents: Always include known industry-preferred equivalents if they meet functional and package criteria.
• Verification Requirements:
  - Confirm lifecycle status (Active, NRND, Last Time Buy)
  - Verify package type, pinout, and core electrical specs from datasheet
  - Analyze block diagrams or functional descriptions and compare to original
  - Confirm functionality using datasheet keywords (PLL, zero delay, fanout buffer, output count, interface type, voltage/current range)
  - Provide price per unit with distributor citation
  - Note any differences (footprint, electrical, interface, software)
  - Include confidence level (High / Medium / Low)
3. For each alternative, include:
   - Part number
   - Brief description of key specifications. Be sure to include the package type and verify it from the manufacturer's datasheet or distributor platforms. Clearly cite the section of the datasheet or distributor listing where the package type is confirmed.
   - Any notable differences from the original part
   - Manufacturer name if known. 
   - List if the alternate part matches the functionality and the package of the original part
   - Price per Unit (with link)
   - Confirmed Package Type (from datasheet ordering code + at least one distributor listing). Cite exact table/section or distributor field. If not verifiable, state “Package type cannot be confirmed” and exclude.
4. Ranking
Rank the 3 alternatives by closeness to the original part using these priorities:
1. Package Match
2. Functional Match, including block diagram similarity
3. Lifecycle Status
4. Distributor Availability
5. Price Competitiveness
If a verified preferred alternate exists, list it first and explain any minor deviations. Include rationale for ranking.
5. Summary & Conclusion
• Provide a clear overview of findings.
• Highlight whether package-compatible alternatives exist or if PCB/firmware adaptations are required.
• Explicitly note differences in functional blocks that may affect compatibility.
• Recommend the most suitable alternatives with reasoning.
• Include date of availability verification for all parts.
   
IMPORTANT: Make each alternative visually distinct and easy to separate. Use clear section breaks, numbered lists, or visual separators between each alternative. Consider using:
- Clear numbered sections (1., 2., 3.)
- Horizontal rules (---) between alternatives
- Distinct headings for each alternative
- Bullet points with clear spacing

Ensure all information is accurate, cited from datasheets or distributor listings, and avoid inventing parts, packages, or specifications. Prioritize functionally equivalent, package-compatible alternates, using block diagram comparison to verify internal functionality.`;


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
            content: 'You are a helpful electronics engineer who specializes in finding component alternatives. Provide accurate, practical alternatives with clear specifications. The alternatives should be package and footprint compatible with similar electrical and timing specifications and if applicable, firmware/register similarities.'
          },
          { role: 'user', content: userPrompt }
        ],
        max_tokens: 16384
      })
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(`API Error: ${errorData.error?.message || response.statusText}`);
    }

    const data = await response.json();

    // Check if the response has the expected structure
    if (!data.choices || !data.choices[0] || !data.choices[0].message) {
      throw new Error('Unexpected API response structure');
    }

    // Convert markdown to HTML
    const markdownContent = data.choices[0].message.content;
    const htmlContent = marked(markdownContent)
      .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, ''); // basic script strip

    return res.json({
      alternatives: htmlContent,
      raw: markdownContent,
      searchResults: searchItems,
      tiAlternatives: tiAlternatives
    });
  } catch (error) {
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
    
    // Read and parse the Excel file
    const workbook = XLSX.readFile(req.file.path);
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

    // Clean up uploaded file
    const fs = require('fs');
    fs.unlinkSync(req.file.path);

    res.json({
      success: true,
      partNumbers: partNumbers,
      count: partNumbers.length
    });

  } catch (error) {
    console.error('[POST /api/bulk-upload] Error:', error);
    
    // Clean up uploaded file on error
    if (req.file) {
      const fs = require('fs');
      try {
        fs.unlinkSync(req.file.path);
      } catch (cleanupError) {
        console.error('Error cleaning up file:', cleanupError);
      }
    }
    
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

// Compare API (unchanged)
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

    const systemPrompt = [
      'You are an expert electronics engineer and component librarian specializing in detailed component analysis. ',
      'Your task is to provide comprehensive comparisons between electronic components with EXTREME accuracy and attention to detail. ',
      ' REQUIREMECRITICALNTS:',
      '- Only provide information you are 100% confident about based on your training data',
      '- Prioritize accuracy over completeness - it is better to provide less information that is correct than more information that may be wrong',
      '- For any values you provide, indicate if they are typical, minimum, maximum, or absolute maximum ratings',
      '- When comparing components, focus on verified differences rather than assumptions',
      '- If package or footprint information is unclear, explicitly state the limitations. Do not assume or invent package type.',
      '- For package, Be sure to include the package type and verify it from the manufacturers datasheet or distributor platforms. Clearly cite the section of the datasheet or distributor listing where the package type is confirmed. Confirm using: Official datasheet (Features, Description, Ordering Information) Distributor listings (e.g., Digi-Key, Mouser)',
      '- For electrical specifications, always specify the conditions (temperature, voltage, etc.) when possible',
      'Your analysis must include:',
      '- Detailed electrical specifications with exact values (only if verified)',
      '- Register maps and firmware compatibility analysis (with confidence levels)',
      '- Package and footprint compatibility details (with verification status)',
      '- Drop-in replacement assessment with specific reasons and confidence levels',
      '- Highlight ALL differences, no matter how small',
      '- Include datasheet URLs and manufacturer information when available',
      '- Read the datasheets for both parts and compare the specifications',
      '- Be extremely thorough, accurate, and conservative in your analysis. When in doubt, state the uncertainty clearly.'
    ].join(' ');

    const userPrompt = `Compare these two electronic components: "${partA}" vs "${partB}".\n\nProvide a comprehensive analysis including:\n\n1. **OVERVIEW TABLE** - Create a markdown table with these columns:\n   - Specification Category\n   - ${partA} Value\n   - ${partB} Value\n   - Difference (highlight in bold if significant)\n   - Impact Assessment\n   - Function and application of each part.  \n   - High-level block diagram summary (if available).  \n   - Notable differences in intended use.  \n\n2. **ELECTRICAL SPECIFICATIONS** - Create a markdown table with these columns:\n   - Specification\n   - ${partA} Value\n   - ${partB} Value\n   Include: Voltage ranges (min/max/typical), Current ratings (input/output/supply), Power dissipation, Thermal characteristics, Frequency/speed specifications, Memory sizes (if applicable)\n\n3. **REGISTER/FIRMWARE COMPATIBILITY** - Create a markdown table with these columns:\n   - Compatibility Aspect\n   - ${partA} Details\n   - ${partB} Details\n   - Register number in hex and register name and function all registers if applicable\n   Include: Register map differences, Firmware compatibility level, Programming differences, Boot sequence variations, Memory organization\n\n4. **PACKAGE & FOOTPRINT** - Create a markdown table with these columns:\n   - Physical Characteristic\n   - ${partA} Specification\n   - ${partB} Specification\n   Include: Package dimensions, Materials, Pin count and spacing, Mounting requirements, Thermal pad differences, Operating temperature range. Side-by-side pinout comparison:  \n       ◦ Table format listing Pin Number, Pin Name/Function for both Part A and Part B. List all pins.  \n       ◦ Explicitly mark mismatches.  \n       ◦ This information should be taken out of manufactuer datasheet . Do not assume. Never invent. \n\n5. **DROP-IN COMPATIBILITY ASSESSMENT**:\n   - Overall compatibility score (0-100%)\n   - Specific reasons for incompatibility\n   - Required modifications for replacement\n   - Risk assessment\n\n6. **RECOMMENDATIONS**:\n   - When to use each part\n   - Migration strategies\n   - Alternative suggestions\n\n**CRITICAL ACCURACY REQUIREMENTS:**\n- Only provide specifications you are 100% confident about\n- For electrical values, always specify if they are min/max/typical/absolute max\n- Include confidence levels for each comparison section\n- When in doubt about compatibility, state the uncertainty clearly\n\nFormat the response in clean markdown with proper tables, code blocks for ASCII art, and ensure all differences are clearly highlighted. Be extremely detailed, thorough, and ACCURATE in your analysis. Prioritize correctness over completeness.`;

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

    // Convert markdown to HTML
    const htmlContent = marked(markdownContent)
      .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '')
      .replace(/<table/g, '<table class="comparison-table"')
      .replace(/<tr/g, '<tr class="comparison-row"')
      .replace(/<td/g, '<td class="comparison-cell"')
      .replace(/<th/g, '<th class="comparison-header"');

    return res.json({ html: htmlContent });
  } catch (error) {
    return res.status(500).json({ error: error.message || 'Server error' });
  }
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Part Alternative Finder server running on port ${PORT}`);
  console.log(`📱 Access from your company network:`);
  console.log(`   Local: http://localhost:${PORT}`);
  console.log(`   Network: http://YOUR_VM_IP:${PORT}`);
  console.log(`   (Replace YOUR_VM_IP with your actual VM IP address)`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully');
  process.exit(0);
});
