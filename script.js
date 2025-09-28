class PartAnalysisTool {
	constructor() {
		// Part alternatives elements
		this.partInput = document.getElementById('partInput');
		this.searchBtn = document.getElementById('searchBtn');
		this.results = document.getElementById('results');
		this.spinner = document.getElementById('spinner');
		
		// Part comparison elements
		this.partAInput = document.getElementById('partAInput');
		this.partBInput = document.getElementById('partBInput');
		this.compareBtn = document.getElementById('compareBtn');
		this.compareSpinner = document.getElementById('compareSpinner');
		this.compareResults = document.getElementById('compareResults');
		
		// Bulk processing elements
		this.bulkUploadArea = document.getElementById('bulkUploadArea');
		this.bulkFileInput = document.getElementById('bulkFileInput');
		this.browseBtn = document.getElementById('browseBtn');
		this.bulkResults = document.getElementById('bulkResults');
		this.bulkSummary = document.getElementById('bulkSummary');
		this.bulkResultsBody = document.getElementById('bulkResultsBody');
		this.exportExcelBtn = document.getElementById('exportExcelBtn');
		this.clearBulkBtn = document.getElementById('clearBulkBtn');
		
		this.bulkResultsData = null;
		
		this.bindEvents();
	}
	
	bindEvents() {
		// Part alternatives events
		this.searchBtn.addEventListener('click', () => this.handleSearch());
		this.partInput.addEventListener('keypress', (e) => {
			if (e.key === 'Enter') {
				this.handleSearch();
			}
		});
		
		// Part comparison events
		this.compareBtn.addEventListener('click', () => this.handleCompare());
		[this.partAInput, this.partBInput].forEach(input => {
			input.addEventListener('keypress', (e) => {
				if (e.key === 'Enter') {
					this.handleCompare();
				}
			});
		});
		
		// Bulk processing events
		this.browseBtn.addEventListener('click', () => this.bulkFileInput.click());
		this.bulkFileInput.addEventListener('change', (e) => this.handleFileUpload(e));
		
		// Drag and drop events
		this.bulkUploadArea.addEventListener('dragover', (e) => this.handleDragOver(e));
		this.bulkUploadArea.addEventListener('dragleave', (e) => this.handleDragLeave(e));
		this.bulkUploadArea.addEventListener('drop', (e) => this.handleDrop(e));
		this.bulkUploadArea.addEventListener('click', () => this.bulkFileInput.click());
		
		// Bulk processing action events
		this.exportExcelBtn.addEventListener('click', () => this.exportBulkResults());
		this.clearBulkBtn.addEventListener('click', () => this.clearBulkResults());
	}
	
	// Part Alternatives Handler
	async handleSearch() {
		const partNumber = this.partInput.value.trim();
		
		if (!partNumber) {
			this.showError('Please enter a part number', 'results');
			return;
		}
		
		this.setLoading(true, 'search');
		
		try {
			const response = await this.findAlternatives(partNumber);
			this.displayResults(response.alternatives, partNumber, response.tiAlternatives);
			
		} catch (error) {
			console.error('Error finding alternatives:', error);
			this.showError(`Failed to find alternatives: ${error.message}`, 'results');
		} finally {
			this.setLoading(false, 'search');
		}
	}
	
	// Part Comparison Handler
	async handleCompare() {
		const partA = this.partAInput.value.trim();
		const partB = this.partBInput.value.trim();
		
		if (!partA || !partB) {
			this.showError('Please enter both Part A and Part B.', 'compare');
			return;
		}
		
		if (partA.toLowerCase() === partB.toLowerCase()) {
			this.showError('Please enter two different parts for comparison.', 'compare');
			return;
		}
		
		this.setLoading(true, 'compare');
		
		try {
			const response = await fetch('/api/compare', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ partA, partB })
			});
			
			if (!response.ok) {
				const err = await response.json().catch(() => ({}));
				throw new Error(err.error || response.statusText);
			}
			
			const data = await response.json();
			
			if (!data || !data.html) {
				throw new Error('Unexpected response from server');
			}
			
			this.displayComparisonResults(data.html, partA, partB);
		} catch (error) {
			this.showError(`Failed to compare parts: ${error.message}`, 'compare');
		} finally {
			this.setLoading(false, 'compare');
		}
	}
	
	// API Calls
	async findAlternatives(partNumber) {
		const response = await fetch('/api/alternatives', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({ partNumber })
		});
		
		if (!response.ok) {
			const errorData = await response.json();
			throw new Error(errorData.error || response.statusText);
		}
		
		const data = await response.json();
		return data;
	}
	
	// Loading States
	setLoading(loading, type) {
		if (type === 'search') {
			this.searchBtn.disabled = loading;
			this.spinner.style.display = loading ? 'block' : 'none';
			
			const buttonSpan = this.searchBtn.querySelector('span');
			if (buttonSpan) {
				buttonSpan.textContent = loading ? 'Searching...' : 'Find Alternatives';
			}
			
			if (loading) {
				this.results.classList.add('loading');
				this.results.innerHTML = `
					<div class="placeholder">
						<div class="placeholder-icon">🔍</div>
						<p>Searching Google and TI cross-reference database...</p>
						<div style="margin-top: 15px; font-size: 0.9rem; color: #666;">
							<div style="margin-bottom: 8px;">✓ Google Search</div>
							<div style="margin-bottom: 8px;">⏳ TI Cross-Reference</div>
							<div>⏳ AI Analysis</div>
						</div>
					</div>
				`;
			} else {
				this.results.classList.remove('loading');
			}
		} else if (type === 'compare') {
			this.compareBtn.disabled = loading;
			this.compareSpinner.style.display = loading ? 'block' : 'none';
			
			const buttonSpan = this.compareBtn.querySelector('span');
			if (buttonSpan) {
				buttonSpan.textContent = loading ? 'Comparing...' : 'Compare Parts';
			}
			
			if (loading) {
				this.compareResults.classList.add('loading');
				this.compareResults.innerHTML = '<div class="placeholder"><div class="placeholder-icon">🤖</div><p>AI is building a comprehensive comparison...</p></div>';
			} else {
				this.compareResults.classList.remove('loading');
			}
		}
	}
	
	// Display Results
	displayResults(alternatives, originalPart, tiAlternatives = []) {
		this.results.innerHTML = '';
		
		// Create header for the original part
		const headerDiv = document.createElement('div');
		headerDiv.className = 'result-item header';
		headerDiv.innerHTML = `
			<div class="result-key">📝 Original Part</div>
			<div class="result-value">${this.escapeHtml(originalPart)}</div>
		`;
		this.results.appendChild(headerDiv);
		
		// Create TI cross-reference section if alternatives found
		if (tiAlternatives && tiAlternatives.length > 0) {
			const tiDiv = document.createElement('div');
			tiDiv.className = 'result-item ti-alternatives';
			tiDiv.innerHTML = `
				<div class="result-key">
					🔗 TI Cross-Reference Alternatives
					<span style="background: #4caf50; color: white; padding: 2px 8px; border-radius: 10px; font-size: 0.7rem; margin-left: 10px;">
						${tiAlternatives.length} found
					</span>
				</div>
				<div class="result-value">${this.formatTIAlternatives(tiAlternatives)}</div>
			`;
			this.results.appendChild(tiDiv);
		} else {
			// Show TI cross-reference section even when no results found
			const tiDiv = document.createElement('div');
			tiDiv.className = 'result-item ti-alternatives';
			tiDiv.innerHTML = `
				<div class="result-key">
					🔗 TI Cross-Reference Alternatives
					<span style="background: #ff9800; color: white; padding: 2px 8px; border-radius: 10px; font-size: 0.7rem; margin-left: 10px;">
						No results
					</span>
				</div>
				<div class="result-value">${this.formatTIAlternatives([])}</div>
			`;
			this.results.appendChild(tiDiv);
		}
		
		// Create the AI alternatives content with better sectioning
		const alternativesDiv = document.createElement('div');
		alternativesDiv.className = 'result-item alternatives';
		alternativesDiv.innerHTML = `
			<div class="result-key">🤖 AI-Powered Alternatives</div>
			<div class="result-value">${this.formatAlternatives(alternatives)}</div>
		`;
		this.results.appendChild(alternativesDiv);
		
		// Add export button after AI alternatives
		console.log('Adding export button with data:', {
			originalPart,
			alternatives: alternatives,
			tiAlternatives: tiAlternatives,
			alternativesLength: alternatives ? alternatives.length : 'undefined',
			tiAlternativesLength: tiAlternatives ? tiAlternatives.length : 'undefined'
		});
		
		this.addExportButton(originalPart, { 
			alternatives: alternatives, 
			tiAlternatives: tiAlternatives 
		});
	}
	
	displayComparisonResults(html, partA, partB) {
		this.compareResults.innerHTML = '';
		
		// Create header for the comparison
		const headerDiv = document.createElement('div');
		headerDiv.className = 'result-item header';
		headerDiv.innerHTML = `
			<div class="result-key">⚖️ Comparison: ${this.escapeHtml(partA)} vs ${this.escapeHtml(partB)}</div>
			<div class="result-value">Detailed analysis with pinout diagrams and specifications</div>
		`;
		this.compareResults.appendChild(headerDiv);
		
		// Create the comparison content
		const comparisonDiv = document.createElement('div');
		comparisonDiv.className = 'result-item alternatives';
		comparisonDiv.innerHTML = `
			<div class="result-key">🔬 Comprehensive Analysis</div>
			<div class="result-value">${this.processComparisonHtml(html)}</div>
		`;
		this.compareResults.appendChild(comparisonDiv);
		
		// Add export options
		this.addExportOptions(html, partA, partB);
	}
	
	// HTML Processing
	processComparisonHtml(html) {
		let processedHtml = html;

		// Add section headers styling for h1-h6 tags
		processedHtml = processedHtml.replace(
			/<h([1-6])>(.*?)<\/h[1-6]>/g,
			'<div class="comparison-section"><h3>$2</h3></div>'
		);

		// Enhance table styling
		processedHtml = processedHtml.replace(
			/<table>/g,
			'<table class="comparison-table">'
		);

		// Add pinout diagram styling for code blocks
		processedHtml = processedHtml.replace(
			/<pre><code>([\s\S]*?)<\/code><\/pre>/g,
			'<div class="pinout-diagram"><pre>$1</pre></div>'
		);

		// Enhance pinout diagrams with better formatting
		processedHtml = processedHtml.replace(
			/(PINOUT|Pinout|pinout)/g,
			'<span class="pinout-difference">$1</span>'
		);

		// Highlight pin 1 indicators
		processedHtml = processedHtml.replace(
			/(Pin 1|PIN 1|pin 1|1\s*[•·])/g,
			'<span class="pin-1">$1</span>'
		);

		// Highlight power pins
		processedHtml = processedHtml.replace(
			/\b(VCC|VDD|VSS|GND|PWR|POWER)\b/gi,
			'<span class="pin-power">$1</span>'
		);

		// Highlight ground pins
		processedHtml = processedHtml.replace(
			/\b(GND|VSS|AGND|DGND)\b/gi,
			'<span class="pin-ground">$1</span>'
		);

		// Highlight signal pins
		processedHtml = processedHtml.replace(
			/\b(CLK|DATA|SDA|SCL|TX|RX|INT|RESET)\b/gi,
			'<span class="pin-signal">$1</span>'
		);

		// Highlight differences in text
		processedHtml = processedHtml.replace(
			/\b(different|differs|unlike|varies|change|incompatible|mismatch)\b/gi,
			'<strong class="pinout-difference">$1</strong>'
		);

		// Highlight similarities
		processedHtml = processedHtml.replace(
			/\b(same|identical|similar|compatible|match|identical|equivalent)\b/gi,
			'<em class="pinout-similar">$1</em>'
		);

		// Highlight compatibility scores
		processedHtml = processedHtml.replace(
			/(\d{1,3})%/g,
			'<span class="compatibility-score compatibility-$1">$1%</span>'
		);

		// Add CSS classes to existing table elements
		processedHtml = processedHtml.replace(
			/<thead>/g,
			'<thead class="comparison-header-row">'
		);
		processedHtml = processedHtml.replace(
			/<tbody>/g,
			'<tbody class="comparison-body">'
		);

		// Enhance ASCII art sections
		processedHtml = processedHtml.replace(
			/(┌─+┐|└─+┘|│.*│)/g,
			'<span class="ascii-art">$1</span>'
		);

		return processedHtml;
	}
	
	formatAlternatives(alternatives) {
		// The server now returns parsed HTML, so we can display it directly
		// The HTML is already sanitized by the server, so we can trust it
		return alternatives;
	}
	
	formatTIAlternatives(tiAlternatives) {
		if (!tiAlternatives || tiAlternatives.length === 0) {
			return `
				<div style="text-align: center; padding: 20px; color: #999; font-style: italic;">
					<div style="font-size: 2rem; margin-bottom: 10px;">🔍</div>
					<p>No TI cross-reference alternatives found for this part.</p>
				</div>
			`;
		}
		
		const alternativesList = tiAlternatives.map((alt, index) => {
			const partNumber = this.escapeHtml(alt.partNumber);
			const title = this.escapeHtml(alt.title);
			const href = this.escapeHtml(alt.href);
			const matchType = this.escapeHtml(alt.matchType || 'Unknown');
			
			// Determine match type styling
			let matchTypeClass = 'match-unknown';
			let matchTypeColor = '#666';
			let matchTypeBg = '#f0f0f0';
			
			if (matchType.toLowerCase().includes('drop-in replacement')) {
				matchTypeClass = 'match-drop-in';
				matchTypeColor = '#2e7d32';
				matchTypeBg = '#c8e6c9';
			} else if (matchType.toLowerCase().includes('exact match')) {
				matchTypeClass = 'match-exact';
				matchTypeColor = '#4caf50';
				matchTypeBg = '#e8f5e8';
			} else if (matchType.toLowerCase().includes('same functionality')) {
				matchTypeClass = 'match-same-functionality';
				matchTypeColor = '#9c27b0';
				matchTypeBg = '#f3e5f5';
			} else if (matchType.toLowerCase().includes('pin compatible')) {
				matchTypeClass = 'match-pin-compatible';
				matchTypeColor = '#ff9800';
				matchTypeBg = '#fff3e0';
			} else if (matchType.toLowerCase().includes('functional equivalent')) {
				matchTypeClass = 'match-functional-equivalent';
				matchTypeColor = '#2196f3';
				matchTypeBg = '#e3f2fd';
			} else if (matchType.toLowerCase().includes('replacement')) {
				matchTypeClass = 'match-replacement';
				matchTypeColor = '#388e3c';
				matchTypeBg = '#e8f5e8';
			} else if (matchType.toLowerCase().includes('compatible')) {
				matchTypeClass = 'match-compatible';
				matchTypeColor = '#ff5722';
				matchTypeBg = '#fbe9e7';
			} else if (matchType.toLowerCase().includes('cross-reference')) {
				matchTypeClass = 'match-cross-reference';
				matchTypeColor = '#607d8b';
				matchTypeBg = '#eceff1';
			}
			
			return `
				<div class="ti-alternative-item" style="margin-bottom: 15px; padding: 15px; background: linear-gradient(135deg, #fff8f5 0%, #f8f9fa 100%); border-radius: 8px; border-left: 4px solid #ff6b35; box-shadow: 0 2px 4px rgba(0,0,0,0.1); transition: all 0.3s ease;">
					<div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 8px;">
						<div style="font-weight: 700; color: #333; font-size: 1.1rem;">
							${index + 1}. ${partNumber}
						</div>
						<div style="display: flex; gap: 8px; align-items: center;">
							<div style="background: ${matchTypeBg}; color: ${matchTypeColor}; padding: 4px 8px; border-radius: 12px; font-size: 0.7rem; font-weight: 600; border: 1px solid ${matchTypeColor}20;">
								${matchType}
							</div>
							<div style="background: #ff6b35; color: white; padding: 4px 8px; border-radius: 12px; font-size: 0.75rem; font-weight: 600;">
								TI PART
							</div>
						</div>
					</div>
					<div style="color: #555; margin-bottom: 12px; font-size: 0.95rem; line-height: 1.4;">
						${title}
					</div>
					<div style="display: flex; justify-content: space-between; align-items: center;">
						<a href="${href}" target="_blank" style="color: #ff6b35; text-decoration: none; font-weight: 600; font-size: 0.9rem; padding: 8px 16px; background: rgba(255, 107, 53, 0.1); border-radius: 6px; transition: all 0.2s ease;">
							🔗 View on TI.com →
						</a>
						<div style="font-size: 0.8rem; color: #999;">
							Verified by TI
						</div>
					</div>
				</div>
			`;
		}).join('');
		
		return `
			<div style="margin-bottom: 20px;">
				<div style="background: linear-gradient(135deg, #ff6b35 0%, #e55a2b 100%); color: white; padding: 15px 20px; border-radius: 8px; margin-bottom: 20px; text-align: center;">
					<div style="font-size: 1.2rem; font-weight: 700; margin-bottom: 5px;">
						🔗 Texas Instruments Cross-Reference
					</div>
					<div style="font-size: 0.9rem; opacity: 0.9;">
						Found ${tiAlternatives.length} verified alternative${tiAlternatives.length !== 1 ? 's' : ''} from TI's official cross-reference database
					</div>
				</div>
				${alternativesList}
				<div style="text-align: center; margin-top: 20px; padding: 15px; background: #f8f9fa; border-radius: 6px; border: 1px solid #e1e5e9;">
					<div style="font-size: 0.85rem; color: #666;">
						<strong>💡 Tip:</strong> These are official TI cross-reference alternatives. Click any part to view detailed specifications on TI.com
					</div>
				</div>
			</div>
		`;
	}
	
	// Error Handling
	showError(message, target) {
		const targetElement = target === 'compare' ? this.compareResults : this.results;
		targetElement.innerHTML = `
			<div class="result-item error">
				<div class="result-key">❌ Error</div>
				<div class="result-value">${this.escapeHtml(message)}</div>
			</div>
		`;
	}
	
	// Export Options
	addExportOptions(html, partA, partB) {
		const exportDiv = document.createElement('div');
		exportDiv.className = 'result-item';
		exportDiv.style.textAlign = 'center';
		exportDiv.style.padding = '20px';
		exportDiv.style.borderTop = '2px solid #e1e5e9';
		exportDiv.style.marginTop = '20px';

		exportDiv.innerHTML = `
			<div class="result-key">📋 Export Options</div>
			<div style="margin-top: 15px;">
				<button id="printBtn" style="margin: 0 10px; padding: 10px 20px; background: #667eea; color: white; border: none; border-radius: 6px; cursor: pointer;">
					🖨️ Print Report
				</button>
				<button id="copyBtn" style="margin: 0 10px; padding: 10px 20px; background: #4caf50; color: white; border: none; border-radius: 6px; cursor: pointer;">
					📋 Copy Text
				</button>
			</div>
		`;

		this.compareResults.appendChild(exportDiv);

		// Add event listeners for the buttons
		document.getElementById('printBtn').addEventListener('click', () => this.printReport(partA, partB));
		document.getElementById('copyBtn').addEventListener('click', () => this.copyToClipboard());
	}

	printReport(partA, partB) {
		const printWindow = window.open('', '_blank');
		const comparisonContent = document.querySelector('#compareResults .result-item.alternatives .result-value').innerHTML;
		
		printWindow.document.write(`
			<!DOCTYPE html>
			<html>
			<head>
				<title>Part Comparison: ${partA} vs ${partB}</title>
				<style>
					body { font-family: Arial, sans-serif; margin: 20px; }
					table { border-collapse: collapse; width: 100%; margin: 20px 0; }
					th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
					th { background-color: #f2f2f2; }
					.pinout-diagram { background: #f5f5f5; border: 1px solid #ddd; padding: 15px; margin: 15px 0; font-family: monospace; white-space: pre; }
					.comparison-section { margin: 20px 0; padding: 10px; background: #f9f9f9; border-left: 3px solid #667eea; }
					@media print { body { margin: 0; } }
				</style>
			</head>
			<body>
				<h1>Part Comparison Report</h1>
				<h2>${partA} vs ${partB}</h2>
				<hr>
				${comparisonContent}
			</body>
			</html>
		`);
		
		printWindow.document.close();
		printWindow.focus();
		
		setTimeout(() => {
			printWindow.print();
			printWindow.close();
		}, 500);
	}

	async copyToClipboard() {
		try {
			const comparisonContent = document.querySelector('#compareResults .result-item.alternatives .result-value');
			if (!comparisonContent) {
				throw new Error('No comparison content found');
			}

			const textContent = comparisonContent.textContent || comparisonContent.innerText;
			
			if (navigator.clipboard && window.isSecureContext) {
				await navigator.clipboard.writeText(textContent);
				this.showCopySuccess();
			} else {
				this.fallbackCopyTextToClipboard(textContent);
			}
		} catch (error) {
			console.error('Copy failed:', error);
			const comparisonContent = document.querySelector('#compareResults .result-item.alternatives .result-value');
			if (comparisonContent) {
				this.fallbackCopyTextToClipboard(comparisonContent.textContent || comparisonContent.innerText);
			}
		}
	}

	fallbackCopyTextToClipboard(text) {
		const textArea = document.createElement('textarea');
		textArea.value = text;
		textArea.style.position = 'fixed';
		textArea.style.left = '-999999px';
		textArea.style.top = '-999999px';
		document.body.appendChild(textArea);
		textArea.focus();
		textArea.select();
		
		try {
			document.execCommand('copy');
			this.showCopySuccess();
		} catch (err) {
			console.error('Fallback copy failed:', err);
			this.showCopyError();
		}
		
		document.body.removeChild(textArea);
	}

	showCopySuccess() {
		const copyBtn = document.getElementById('copyBtn');
		const originalText = copyBtn.innerHTML;
		copyBtn.innerHTML = '✅ Copied!';
		copyBtn.style.background = '#4caf50';
		
		setTimeout(() => {
			copyBtn.innerHTML = originalText;
			copyBtn.style.background = '#4caf50';
		}, 2000);
	}

	showCopyError() {
		const copyBtn = document.getElementById('copyBtn');
		const originalText = copyBtn.innerHTML;
		copyBtn.innerHTML = '❌ Failed';
		copyBtn.style.background = '#f44336';
		
		setTimeout(() => {
			copyBtn.innerHTML = originalText;
			copyBtn.style.background = '#4caf50';
		}, 2000);
	}
	
	// PDF Export Functions
	exportToPDF(partNumber, results) {
		console.log('Export to PDF called with:', partNumber, results);
		console.log('Results structure:', {
			tiAlternatives: results.tiAlternatives,
			alternatives: results.alternatives,
			tiAlternativesType: typeof results.tiAlternatives,
			alternativesType: typeof results.alternatives,
			tiAlternativesIsArray: Array.isArray(results.tiAlternatives),
			alternativesIsArray: Array.isArray(results.alternatives)
		});
		console.log('Full results object keys:', Object.keys(results));
		console.log('Full results object:', JSON.stringify(results, null, 2));
		
		// Try jsPDF first, fallback to print if not available
		if (typeof window.jspdf !== 'undefined') {
			this.exportToPDFWithJsPDF(partNumber, results);
		} else {
			this.exportToPDFWithPrint(partNumber, results);
		}
	}
	
	exportToPDFWithJsPDF(partNumber, results) {
		const { jsPDF } = window.jspdf;
		const doc = new jsPDF();

		// Handle both array and HTML string formats for alternatives
		let alternatives = [];
		if (Array.isArray(results.alternatives)) {
			alternatives = results.alternatives;
		} else if (typeof results.alternatives === 'string') {
			// Try to parse HTML to extract alternatives
			alternatives = this.parseAlternativesFromHTML(results.alternatives);
		}
		
		const tiAlternatives = Array.isArray(results.tiAlternatives) ? results.tiAlternatives : [];

		// Set up colors
		const primaryColor = [220, 38, 38]; // Red
		const secondaryColor = [100, 100, 100]; // Gray

		// Header
		doc.setFillColor(...primaryColor);
		doc.rect(0, 0, 210, 30, 'F');

		doc.setTextColor(255, 255, 255);
		doc.setFontSize(20);
		doc.text('Part Analysis Report', 20, 20);

		// Part info
		doc.setTextColor(0, 0, 0);
		doc.setFontSize(14);
		doc.text(`Part Number: ${partNumber}`, 20, 45);
		doc.text(`Generated: ${new Date().toLocaleDateString()}`, 20, 55);

		// Count total alternatives
		const tiCount = tiAlternatives.length;
		const aiCount = alternatives.length;
		const totalCount = tiCount + aiCount;
		doc.text(`Total Alternatives: ${totalCount}`, 20, 65);
		
		let yPosition = 80;
		
		// TI Cross-Reference Section
		if (tiAlternatives && tiAlternatives.length > 0) {
			// TI Section Header
			doc.setFontSize(14);
			doc.setTextColor(0, 0, 0);
			doc.text('🔗 TI Cross-Reference Alternatives', 20, yPosition);
			
			yPosition += 15;
			
			// TI Alternatives - simple format like UI
			tiAlternatives.forEach((result, index) => {
				if (yPosition > 270) {
					doc.addPage();
					yPosition = 20;
				}
				
				// Part number - bold
				doc.setFontSize(12);
				doc.setTextColor(0, 0, 0);
				doc.text(`${result.partNumber}`, 20, yPosition);
				
				yPosition += 8;
				
				// Match type
				doc.setFontSize(10);
				doc.setTextColor(100, 100, 100);
				doc.text(`Match Type: ${result.matchType}`, 20, yPosition);
				
				yPosition += 6;
				
				// Description
				doc.setFontSize(10);
				doc.setTextColor(80, 80, 80);
				const description = result.title || 'No description available';
				const splitDescription = doc.splitTextToSize(description, 170);
				doc.text(splitDescription, 20, yPosition);
				
				yPosition += 6 + (splitDescription.length * 4);
				yPosition += 10; // Space between alternatives
			});
		}
		
		// AI Alternatives Section
		if (alternatives && alternatives.length > 0) {
			// AI Section Header
			doc.setFontSize(14);
			doc.setTextColor(0, 0, 0);
			doc.text('🤖 AI-Powered Alternatives', 20, yPosition);
			
			yPosition += 15;
			
			// AI Alternatives - simple format like UI
			alternatives.forEach((result, index) => {
				if (yPosition > 270) {
					doc.addPage();
					yPosition = 20;
				}
				
				// Part number - bold
				doc.setFontSize(12);
				doc.setTextColor(0, 0, 0);
				doc.text(`${result.partNumber || result.name || 'Unknown Part'}`, 20, yPosition);
				
				yPosition += 8;
				
				// Description
				doc.setFontSize(10);
				doc.setTextColor(100, 100, 100);
				const description = result.description || result.reasoning || 'No description available';
				const splitDescription = doc.splitTextToSize(description, 170);
				doc.text(splitDescription, 20, yPosition);
				
				yPosition += 6 + (splitDescription.length * 4);
				
				// Specifications - simple list
				if (result.specifications && result.specifications.length > 0) {
					result.specifications.forEach((spec, specIndex) => {
						if (yPosition > 270) {
							doc.addPage();
							yPosition = 20;
						}
						
						doc.setFontSize(9);
						doc.setTextColor(80, 80, 80);
						const specText = `• ${spec}`;
						const splitSpec = doc.splitTextToSize(specText, 160);
						doc.text(splitSpec, 25, yPosition);
						
						yPosition += 4 + (splitSpec.length * 3);
					});
				}
				
				yPosition += 10; // Space between alternatives
			});
		}
		
		// Summary Section
		if (yPosition > 250) {
			doc.addPage();
			yPosition = 20;
		}
		
		// Summary Header
		doc.setFontSize(14);
		doc.setTextColor(0, 0, 0);
		doc.text('📋 Summary', 20, yPosition);
		
		yPosition += 15;
		
		// Summary Content
		doc.setFontSize(10);
		doc.setTextColor(0, 0, 0);
		
		const summaryText = `This report analyzed ${partNumber} and found ${totalCount} alternative components:
		
• TI Cross-Reference Alternatives: ${tiCount} found
• AI-Powered Alternatives: ${aiCount} found

The alternatives listed above provide various options for replacing the original part, with detailed specifications to help in the selection process.`;
		
		const splitSummary = doc.splitTextToSize(summaryText, 170);
		doc.text(splitSummary, 20, yPosition);
		
		yPosition += 20 + (splitSummary.length * 4);
		
		// Footer
		doc.setFontSize(8);
		doc.setTextColor(...secondaryColor);
		doc.text('Generated by Part Analysis Tool', 20, 290);
		
		// Save PDF
		doc.save(`part-analysis-${partNumber}.pdf`);
	}
	
	exportToPDFWithPrint(partNumber, results) {
		console.log('Using print-based PDF export');
		
		// Create a new window for printing
		const printWindow = window.open('', '_blank');
		
		// Generate HTML content for the PDF
		const htmlContent = this.generatePDFHTML(partNumber, results);
		
		printWindow.document.write(htmlContent);
		printWindow.document.close();
		
		// Wait for content to load, then print
		setTimeout(() => {
			printWindow.print();
			printWindow.close();
		}, 500);
	}
	
	generatePDFHTML(partNumber, results) {
		// Handle both array and HTML string formats for alternatives
		let alternatives = [];
		if (Array.isArray(results.alternatives)) {
			alternatives = results.alternatives;
		} else if (typeof results.alternatives === 'string') {
			// Try to parse HTML to extract alternatives
			alternatives = this.parseAlternativesFromHTML(results.alternatives);
		}
		
		const tiAlternatives = Array.isArray(results.tiAlternatives) ? results.tiAlternatives : [];
		
		const tiCount = tiAlternatives.length;
		const aiCount = alternatives.length;
		const totalCount = tiCount + aiCount;
		
		return `
<!DOCTYPE html>
<html>
<head>
    <title>Part Analysis Report - ${partNumber}</title>
    <style>
        body { 
            font-family: Arial, sans-serif; 
            margin: 20px; 
            color: #333;
            line-height: 1.6;
        }
        .header { 
            background: #dc2626; 
            color: white; 
            padding: 20px; 
            text-align: center; 
            margin-bottom: 30px;
            border-radius: 8px;
        }
        .header h1 { margin: 0; font-size: 24px; }
        .header p { margin: 5px 0 0 0; font-size: 14px; opacity: 0.9; }
        .part-info { 
            background: #f8f9fa; 
            padding: 15px; 
            border-radius: 8px; 
            margin-bottom: 20px;
            border-left: 4px solid #dc2626;
        }
        .section { 
            margin-bottom: 30px; 
            page-break-inside: avoid;
        }
        .section-header { 
            background: #e9ecef; 
            padding: 10px 15px; 
            font-weight: bold; 
            color: #dc2626;
            border-radius: 5px;
            margin-bottom: 15px;
        }
        .result-item { 
            background: #fff; 
            border: 1px solid #dee2e6; 
            padding: 15px; 
            margin-bottom: 10px; 
            border-radius: 5px;
            border-left: 4px solid #dc2626;
        }
        .part-number { 
            font-weight: bold; 
            color: #dc2626; 
            font-size: 16px; 
            margin-bottom: 5px;
        }
        .match-type { 
            color: #6c757d; 
            font-size: 14px; 
            margin-bottom: 8px;
        }
        .description { 
            color: #495057; 
            font-size: 14px;
        }
        .ti-badge {
            background: #dc2626;
            color: white;
            padding: 2px 8px;
            border-radius: 10px;
            font-size: 12px;
            font-weight: bold;
            display: inline-block;
            margin-left: 10px;
        }
        .specifications {
            margin-top: 10px;
            padding: 10px;
            background: #f8f9fa;
            border-radius: 5px;
            border-left: 3px solid #dc2626;
        }
        .specs-header {
            font-weight: bold;
            color: #dc2626;
            margin-bottom: 8px;
            font-size: 14px;
        }
        .specs-list {
            margin: 0;
            padding-left: 20px;
        }
        .specs-list li {
            margin-bottom: 5px;
            color: #495057;
            font-size: 13px;
            line-height: 1.4;
        }
        .footer { 
            text-align: center; 
            margin-top: 40px; 
            padding-top: 20px; 
            border-top: 1px solid #dee2e6; 
            color: #6c757d; 
            font-size: 12px;
        }
        @media print {
            body { margin: 0; }
            .header { margin-bottom: 20px; }
        }
    </style>
</head>
<body>
    <div class="header">
        <h1>Part Analysis Report</h1>
        <p>Generated on ${new Date().toLocaleDateString()} at ${new Date().toLocaleTimeString()}</p>
    </div>
    
    <div class="part-info">
        <strong>Part Number:</strong> ${partNumber}<br>
        <strong>Analysis Date:</strong> ${new Date().toLocaleString()}<br>
        <strong>Total Alternatives Found:</strong> ${totalCount}
    </div>
    
    ${tiCount > 0 ? `
    <div class="section">
        <h3>🔗 TI Cross-Reference Alternatives</h3>
        ${tiAlternatives.map((result, index) => `
            <div style="margin-bottom: 15px;">
                <div style="font-weight: bold; font-size: 14px; margin-bottom: 5px;">${result.partNumber || 'Unknown Part'}</div>
                <div style="color: #666; font-size: 12px; margin-bottom: 3px;">Match Type: ${result.matchType || 'Unknown'}</div>
                <div style="color: #555; font-size: 12px;">${result.title || 'No description available'}</div>
            </div>
        `).join('')}
    </div>
    ` : ''}
    
    ${aiCount > 0 ? `
    <div class="section">
        <h3>🤖 AI-Powered Alternatives</h3>
        ${alternatives.map((result, index) => `
            <div style="margin-bottom: 15px;">
                <div style="font-weight: bold; font-size: 14px; margin-bottom: 5px;">${result.partNumber || result.name || 'Unknown Part'}</div>
                <div style="color: #555; font-size: 12px; margin-bottom: 5px;">${result.description || result.reasoning || 'No description available'}</div>
                ${result.specifications && result.specifications.length > 0 ? `
                    <div style="margin-left: 10px;">
                        ${result.specifications.map(spec => `<div style="color: #666; font-size: 11px; margin-bottom: 2px;">• ${spec}</div>`).join('')}
                    </div>
                ` : ''}
            </div>
        `).join('')}
    </div>
    ` : ''}
    
    <div class="section">
        <h3>📋 Summary</h3>
        <div style="margin-bottom: 15px;">
            <div style="color: #555; font-size: 12px; line-height: 1.5;">
                This report analyzed <strong>${partNumber}</strong> and found <strong>${totalCount}</strong> alternative components:<br><br>
                • <strong>TI Cross-Reference Alternatives:</strong> ${tiCount} found<br>
                • <strong>AI-Powered Alternatives:</strong> ${aiCount} found<br><br>
                The alternatives listed above provide various options for replacing the original part, with detailed specifications to help in the selection process.
            </div>
        </div>
    </div>
    
    <div class="footer">
        Generated by Part Analysis Tool
    </div>
</body>
</html>`;
	}
	
	addExportButton(partNumber, results) {
		console.log('Adding export button for:', partNumber, results);
		console.log('Export button data details:', {
			partNumber,
			results,
			alternatives: results.alternatives,
			tiAlternatives: results.tiAlternatives,
			alternativesType: typeof results.alternatives,
			tiAlternativesType: typeof results.tiAlternatives,
			alternativesIsArray: Array.isArray(results.alternatives),
			tiAlternativesIsArray: Array.isArray(results.tiAlternatives)
		});
		
		// Remove existing export button if any
		const existingBtn = document.querySelector('.export-btn');
		if (existingBtn) {
			existingBtn.remove();
		}
		
		const exportButton = document.createElement('button');
		exportButton.innerHTML = '📄 Export to PDF';
		exportButton.className = 'export-btn';
		
		// Fix context issue by binding the function properly
		const self = this;
		exportButton.onclick = function() {
			console.log('Export button clicked!');
			
			try {
				self.exportToPDF(partNumber, results);
			} catch (error) {
				console.error('PDF export error:', error);
				alert('Error generating PDF: ' + error.message);
			}
		};
		
		// Add to results area (append at the end)
		const resultsArea = document.getElementById('results');
		if (resultsArea) {
			resultsArea.appendChild(exportButton);
			console.log('Export button added to results area');
		} else {
			console.error('Results area not found!');
		}
	}

	// Utility Methods
	escapeHtml(text) {
		const div = document.createElement('div');
		div.textContent = text;
		return div.innerHTML;
	}
	
	parseAlternativesFromHTML(htmlString) {
		try {
			// Create a temporary DOM element to parse the HTML
			const tempDiv = document.createElement('div');
			tempDiv.innerHTML = htmlString;
			
			const alternatives = [];
			
			// Look for structured alternatives in the HTML
			// Pattern 1: Look for headings that might indicate alternatives
			const headings = tempDiv.querySelectorAll('h1, h2, h3, h4, h5, h6');
			headings.forEach(heading => {
				const headingText = heading.textContent.trim();
				// Check if heading contains a part number
				const partMatch = headingText.match(/([A-Z0-9][A-Z0-9\-\.\/]+)/i);
				if (partMatch) {
					const partNumber = partMatch[1];
					// Look for specifications in the next sibling elements
					let specs = [];
					let currentElement = heading.nextElementSibling;
					
					while (currentElement && currentElement.tagName !== 'H1' && currentElement.tagName !== 'H2' && currentElement.tagName !== 'H3' && currentElement.tagName !== 'H4' && currentElement.tagName !== 'H5' && currentElement.tagName !== 'H6') {
						if (currentElement.tagName === 'UL' || currentElement.tagName === 'OL') {
							const listItems = currentElement.querySelectorAll('li');
							listItems.forEach(li => {
								const spec = li.textContent.trim();
								if (spec && !spec.toLowerCase().includes('alternative') && !spec.toLowerCase().includes('replacement')) {
									specs.push(spec);
								}
							});
						} else if (currentElement.tagName === 'P') {
							const text = currentElement.textContent.trim();
							if (text && !text.toLowerCase().includes('alternative') && !text.toLowerCase().includes('replacement')) {
								specs.push(text);
							}
						}
						currentElement = currentElement.nextElementSibling;
					}
					
					alternatives.push({
						partNumber: partNumber,
						description: headingText,
						specifications: specs
					});
				}
			});
			
			// Pattern 2: Look for part numbers in strong/bold tags with surrounding context
			const strongElements = tempDiv.querySelectorAll('strong, b');
			strongElements.forEach(element => {
				const text = element.textContent.trim();
				// Check if it looks like a part number (contains letters and numbers)
				if (text.match(/^[A-Z0-9][A-Z0-9\-\.\/]+$/i) && text.length > 3) {
					// Find the description and specs in the parent or next elements
					let description = '';
					let specs = [];
					
					// Check parent element for description
					const parent = element.parentElement;
					if (parent) {
						const parentText = parent.textContent.trim();
						description = parentText.replace(text, '').trim();
						
						// Look for specifications in sibling elements
						let currentElement = parent.nextElementSibling;
						while (currentElement && currentElement.tagName !== 'STRONG' && currentElement.tagName !== 'B') {
							if (currentElement.tagName === 'UL' || currentElement.tagName === 'OL') {
								const listItems = currentElement.querySelectorAll('li');
								listItems.forEach(li => {
									const spec = li.textContent.trim();
									if (spec && !spec.toLowerCase().includes('alternative') && !spec.toLowerCase().includes('replacement')) {
										specs.push(spec);
									}
								});
							} else if (currentElement.tagName === 'P') {
								const specText = currentElement.textContent.trim();
								if (specText && !specText.toLowerCase().includes('alternative') && !specText.toLowerCase().includes('replacement')) {
									specs.push(specText);
								}
							}
							currentElement = currentElement.nextElementSibling;
						}
					}
					
					// Only add if we haven't already added this part number
					if (!alternatives.find(alt => alt.partNumber === text)) {
						alternatives.push({
							partNumber: text,
							description: description || 'No description available',
							specifications: specs
						});
					}
				}
			});
			
			// Pattern 3: Look for list items that might contain alternatives
			const listItems = tempDiv.querySelectorAll('li');
			listItems.forEach(li => {
				const text = li.textContent.trim();
				// Look for part numbers at the beginning of list items
				const partMatch = text.match(/^([A-Z0-9][A-Z0-9\-\.\/]+)\s*[:-]?\s*(.*)/i);
				if (partMatch) {
					const partNumber = partMatch[1];
					const description = partMatch[2];
					
					// Only add if we haven't already added this part number
					if (!alternatives.find(alt => alt.partNumber === partNumber)) {
						alternatives.push({
							partNumber: partNumber,
							description: description || 'No description available',
							specifications: []
						});
					}
				}
			});
			
			// If no alternatives found, return a message
			if (alternatives.length === 0) {
				alternatives.push({
					partNumber: 'See UI for details',
					description: 'AI-powered alternatives are available in the web interface. The PDF export currently shows TI cross-reference results only.',
					specifications: []
				});
			}
			
			return alternatives;
		} catch (error) {
			console.error('Error parsing alternatives from HTML:', error);
			return [{
				partNumber: 'See UI for details',
				description: 'AI-powered alternatives are available in the web interface. The PDF export currently shows TI cross-reference results only.',
				specifications: []
			}];
		}
	}
	
	// Bulk Processing Methods
	handleDragOver(e) {
		e.preventDefault();
		this.bulkUploadArea.classList.add('dragover');
	}
	
	handleDragLeave(e) {
		e.preventDefault();
		this.bulkUploadArea.classList.remove('dragover');
	}
	
	handleDrop(e) {
		e.preventDefault();
		this.bulkUploadArea.classList.remove('dragover');
		
		const files = e.dataTransfer.files;
		if (files.length > 0) {
			this.bulkFileInput.files = files;
			this.handleFileUpload({ target: { files: files } });
		}
	}
	
	async handleFileUpload(e) {
		const file = e.target.files[0];
		if (!file) return;
		
		// Validate file type
		const allowedTypes = [
			'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
			'application/vnd.ms-excel',
			'text/csv'
		];
		
		if (!allowedTypes.includes(file.type)) {
			this.showBulkError('Please upload an Excel file (.xlsx, .xls) or CSV file.');
			return;
		}
		
		// Validate file size (5MB limit)
		if (file.size > 5 * 1024 * 1024) {
			this.showBulkError('File size must be less than 5MB.');
			return;
		}
		
		try {
			// Upload file to server
			const formData = new FormData();
			formData.append('file', file);
			
			this.showBulkLoading('Uploading and processing file...');
			
			const response = await fetch('/api/bulk-upload', {
				method: 'POST',
				body: formData
			});
			
			if (!response.ok) {
				const errorData = await response.json();
				throw new Error(errorData.error || 'Upload failed');
			}
			
			const data = await response.json();
			console.log('File uploaded successfully:', data);
			
			// Process the part numbers
			await this.processBulkParts(data.partNumbers);
			
		} catch (error) {
			console.error('File upload error:', error);
			this.showBulkError(`Upload failed: ${error.message}`);
		}
	}
	
	async processBulkParts(partNumbers) {
		try {
			this.showBulkLoading(`Processing ${partNumbers.length} part numbers...`);
			
			const response = await fetch('/api/bulk-process', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json'
				},
				body: JSON.stringify({ partNumbers })
			});
			
			if (!response.ok) {
				const errorData = await response.json();
				throw new Error(errorData.error || 'Processing failed');
			}
			
			const data = await response.json();
			console.log('Bulk processing complete:', data);
			
			this.bulkResultsData = data;
			this.displayBulkResults(data);
			
		} catch (error) {
			console.error('Bulk processing error:', error);
			this.showBulkError(`Processing failed: ${error.message}`);
		}
	}
	
	displayBulkResults(data) {
		// Hide loading state
		this.bulkUploadArea.classList.remove('bulk-processing');
		
		// Show results
		this.bulkResults.style.display = 'block';
		
		// Update summary
		this.bulkSummary.innerHTML = `
			<h4>📊 Bulk Processing Complete</h4>
			<p><strong>Total Parts Processed:</strong> ${data.totalProcessed}</p>
			<p><strong>Successful:</strong> ${data.successCount} | <strong>Errors:</strong> ${data.errorCount}</p>
			<p><strong>Processing Time:</strong> ${new Date().toLocaleTimeString()}</p>
		`;
		
		// Clear and populate results table
		this.bulkResultsBody.innerHTML = '';
		
		data.results.forEach(result => {
			const row = document.createElement('tr');
			
			const tiAlt = result.tiAlternatives.length > 0 
				? `${result.tiAlternatives[0].partNumber}` 
				: 'N/A';
			
			const matchType = result.tiAlternatives.length > 0 
				? `${result.tiAlternatives[0].matchType || 'Cross-Reference Match'}` 
				: 'N/A';
			
			const aiAlt1 = result.aiAlternatives.length > 0 
				? `${result.aiAlternatives[0].partNumber}` 
				: 'N/A';
			
			const aiAlt2 = result.aiAlternatives.length > 1 
				? `${result.aiAlternatives[1].partNumber}` 
				: 'N/A';
			
			const aiAlt3 = result.aiAlternatives.length > 2 
				? `${result.aiAlternatives[2].partNumber}` 
				: 'N/A';
			
			row.innerHTML = `
				<td class="part-number">${this.escapeHtml(result.originalPart)}</td>
				<td class="alternative-cell">${this.escapeHtml(tiAlt)}</td>
				<td class="match-type-cell">${this.escapeHtml(matchType)}</td>
				<td class="alternative-cell">${this.escapeHtml(aiAlt1)}</td>
				<td class="alternative-cell">${this.escapeHtml(aiAlt2)}</td>
				<td class="alternative-cell">${this.escapeHtml(aiAlt3)}</td>
				<td class="status-${result.status}">${result.status === 'success' ? '✅ Success' : '❌ Error'}</td>
			`;
			
			this.bulkResultsBody.appendChild(row);
		});
		
		// Scroll to results
		this.bulkResults.scrollIntoView({ behavior: 'smooth' });
	}
	
	async exportBulkResults() {
		if (!this.bulkResultsData) {
			this.showBulkError('No results to export. Please process some parts first.');
			return;
		}
		
		try {
			const resultsParam = encodeURIComponent(JSON.stringify(this.bulkResultsData.results));
			const exportUrl = `/api/bulk-export/excel?results=${resultsParam}`;
			
			// Create a temporary link to trigger download
			const link = document.createElement('a');
			link.href = exportUrl;
			link.download = `part-alternatives-bulk-${new Date().toISOString().split('T')[0]}.xlsx`;
			document.body.appendChild(link);
			link.click();
			document.body.removeChild(link);
			
			console.log('Excel export initiated');
			
		} catch (error) {
			console.error('Export error:', error);
			this.showBulkError(`Export failed: ${error.message}`);
		}
	}
	
	clearBulkResults() {
		this.bulkResultsData = null;
		this.bulkResults.style.display = 'none';
		this.bulkFileInput.value = '';
		this.bulkUploadArea.classList.remove('bulk-processing');
	}
	
	showBulkLoading(message) {
		this.bulkUploadArea.classList.add('bulk-processing');
		this.bulkUploadArea.innerHTML = `
			<div class="processing-message">
				<div class="processing-spinner"></div>
				<h4>Processing...</h4>
				<p>${message}</p>
				<p style="font-size: 0.9rem; color: #9ca3af;">This may take a few minutes for multiple parts</p>
			</div>
		`;
	}
	
	showBulkError(message) {
		this.bulkUploadArea.classList.remove('bulk-processing');
		this.bulkUploadArea.innerHTML = `
			<div class="upload-content">
				<div class="upload-icon">❌</div>
				<h3>Upload Error</h3>
				<p style="color: #dc2626; font-weight: 600;">${this.escapeHtml(message)}</p>
				<button id="browseBtn" class="browse-btn">Try Again</button>
			</div>
		`;
		
		// Re-bind the browse button
		document.getElementById('browseBtn').addEventListener('click', () => this.bulkFileInput.click());
	}
}

// Initialize the app when the page loads
document.addEventListener('DOMContentLoaded', () => {
	new PartAnalysisTool();
});