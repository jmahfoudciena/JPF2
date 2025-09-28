# Part Analysis Tool

AI-powered electronic component search and comparison platform with bulk processing capabilities.

## Features

- **Part Alternatives**: Find 3 AI-powered alternative components
- **Part Comparison**: Detailed side-by-side analysis with pinout diagrams
- **TI Cross-Reference**: Integration with Texas Instruments' official database
- **Bulk Processing**: Upload Excel files with up to 10 part numbers
- **Excel Export**: Download comprehensive analysis reports
- **Google Search**: Real-time component information and pricing

## Quick Start

### 1. Get API Keys
- **OpenAI API Key**: [platform.openai.com/api-keys](https://platform.openai.com/api-keys)
- **Google API Key**: [console.developers.google.com](https://console.developers.google.com/)
- **Google CX ID**: [cse.google.com](https://cse.google.com/)

### 2. Set Environment Variables
Create a `.env` file:
```env
OPENAI_API_KEY=sk-your-openai-api-key-here
GOOGLE_API_KEY=your-google-api-key-here
GOOGLE_CX=your-custom-search-engine-id-here
PORT=3000
NODE_ENV=production
```

### 3. Install Dependencies
```bash
npm install
```

### 4. Start Server
```bash
npm start
```

### 5. Access Application
Open [http://localhost:3000](http://localhost:3000) in your browser.

## Deployment

### Vercel (Recommended)
1. Go to [vercel.com](https://vercel.com)
2. Sign up/Login
3. Click "New Project"
4. Upload your project folder
5. Set environment variables in dashboard
6. Deploy!

### Other Platforms
- **Railway**: Upload and set environment variables
- **Netlify**: Use serverless functions
- **Heroku**: Connect GitHub repository

## Usage

### Single Part Analysis
1. Enter a part number (e.g., LM317, NE555)
2. Click "Find Alternatives"
3. Review TI cross-reference and AI alternatives
4. Export results to PDF

### Part Comparison
1. Enter two part numbers
2. Click "Compare Parts"
3. Review detailed comparison with pinout diagrams
4. Export comparison report

### Bulk Processing
1. Create Excel file with part numbers in first column
2. Upload file (drag & drop or browse)
3. Wait for processing (30-60 seconds per part)
4. Review results in table format
5. Export to Excel

## API Endpoints

- `POST /api/alternatives` - Find part alternatives
- `POST /api/compare` - Compare two parts
- `POST /api/bulk-upload` - Upload Excel file
- `POST /api/bulk-process` - Process multiple parts
- `GET /api/bulk-export/excel` - Export results to Excel
- `GET /health` - Server health check

## File Structure

```
├── index.html          # Main application interface
├── script.js           # Client-side JavaScript
├── styles.css          # Application styling
├── server.js           # Express server with API endpoints
├── package.json        # Dependencies and scripts
├── vercel.json         # Vercel deployment configuration
├── uploads/            # Temporary file storage
├── sample-parts.csv    # Sample file for testing
└── README.md           # This file
```

## Technology Stack

- **Backend**: Node.js, Express.js
- **Frontend**: HTML5, CSS3, Vanilla JavaScript
- **AI**: OpenAI GPT-4
- **Search**: Google Custom Search API
- **Scraping**: Puppeteer
- **File Processing**: Multer, XLSX
- **Security**: Helmet.js, CORS, Rate Limiting

## Security Features

- Server-side API key protection
- Rate limiting (100 requests per 15 minutes per IP)
- Input validation and sanitization
- File upload restrictions
- CORS configuration for public access
- Security headers with Helmet.js

## Performance

- Parallel processing for bulk operations
- Optimized Puppeteer configuration
- Request caching and deduplication
- Global CDN delivery (Vercel)
- Responsive design for all devices

## Troubleshooting

### Common Issues
- **API errors**: Check environment variables
- **File upload fails**: Verify file format (.xlsx, .xls, .csv)
- **Module errors**: Run `npm install`
- **CORS errors**: Already configured for public access

### Support
- Check server logs for detailed error messages
- Verify API keys are correct and have sufficient credits
- Test locally before deploying

## License

MIT License - See LICENSE file for details

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

---

**Ready to analyze electronic components?** Deploy to Vercel and start using the tool!