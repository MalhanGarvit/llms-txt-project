require('dotenv').config();
const express = require('express');
const nodemailer = require('nodemailer');
const path = require('path');
const axios = require('axios');
const { parseStringPromise } = require('xml2js');
const { GoogleGenerativeAI } = require("@google/generative-ai");

const app = express();
const PORT = process.env.PORT || 3000;

// Initialize Gemini with API key from environment variables
const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);
if (!process.env.GOOGLE_API_KEY) {
  console.error("ERROR: GOOGLE_API_KEY environment variable is not set. Please set it in your .env file.");
}

// Middleware to parse incoming data
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static files from the public directory
app.use(express.static('public'));

// Set up Nodemailer transporter using Gmail SMTP with improved timeout settings
const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST || 'smtp.gmail.com',
  port: Number(process.env.EMAIL_PORT || 465),
  secure: process.env.EMAIL_SECURE === 'true', // true for 465
  auth: {
    user: process.env.EMAIL_USER || "llmstxt@gmail.com",
    pass: process.env.EMAIL_PASS || "eeng nhqv dyit ddhz"
  },
  // Add timeout settings to prevent unexpected socket close
  connectionTimeout: 60000, // 60 seconds
  greetingTimeout: 30000,   // 30 seconds
  socketTimeout: 60000,     // 60 seconds
  // Keep connection alive
  pool: true,
  maxConnections: 5,
  rateDelta: 1000,
  rateLimit: 5
});

// Verify transporter connection on startup
transporter.verify(function(error, success) {
  if (error) {
    console.error('SMTP server connection error:', error);
  } else {
    console.log('SMTP server connection is ready to accept messages');
  }
});

// Function to get sitemap URL from domain with improved error handling
async function getSitemapUrl(domain) {
  // Clean up domain (remove http/https if present)
  let cleanDomain = domain;
  if (cleanDomain.startsWith('http://')) {
    cleanDomain = cleanDomain.substring(7);
  } else if (cleanDomain.startsWith('https://')) {
    cleanDomain = cleanDomain.substring(8);
  }
  
  // Remove trailing slash if present
  if (cleanDomain.endsWith('/')) {
    cleanDomain = cleanDomain.slice(0, -1);
  }
  
  // Try common sitemap locations
  const possibleLocations = [
    `https://${cleanDomain}/sitemap.xml`,
    `https://${cleanDomain}/sitemap_index.xml`,
    `https://${cleanDomain}/sitemap.php`,
    `https://${cleanDomain}/sitemap.txt`
  ];
  
  for (const url of possibleLocations) {
    try {
      console.log(`Trying sitemap at: ${url}`);
      const response = await axios.get(url, { 
        timeout: 10000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        }
      });
      if (response.status === 200) {
        console.log(`Found sitemap at: ${url}`);
        return url;
      }
    } catch (error) {
      console.log(`No sitemap at: ${url} - ${error.message}`);
      // Continue to next location
    }
  }
  
  // If no sitemap found, try robots.txt for sitemap reference
  try {
    const robotsUrl = `https://${cleanDomain}/robots.txt`;
    console.log(`Checking robots.txt at: ${robotsUrl}`);
    const response = await axios.get(robotsUrl, { 
      timeout: 10000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      }
    });
    
    if (response.status === 200) {
      const robotsContent = response.data;
      const sitemapMatch = robotsContent.match(/Sitemap:\s*(\S+)/i);
      
      if (sitemapMatch && sitemapMatch[1]) {
        console.log(`Found sitemap reference in robots.txt: ${sitemapMatch[1]}`);
        return sitemapMatch[1];
      }
    }
  } catch (error) {
    console.log(`Error checking robots.txt: ${error.message}`);
    // No robots.txt or sitemap reference found
  }
  
  console.log(`No sitemap found for domain: ${cleanDomain}`);
  return null;
}

/**
 * Function to extract URLs from sitemap XML and format them into a simple numbered list
 * @param {string} sitemapXml - The raw XML content of the sitemap
 * @param {string} domain - The domain name for context
 * @returns {string} A formatted, numbered list of URLs
 */
async function extractAndFormatUrls(sitemapXml, domain) {
  try {
    console.log(`Extracting URLs from sitemap, XML size: ${sitemapXml.length} bytes`);
    // Check if it's a sitemap index
    if (sitemapXml.includes('<sitemapindex')) {
      console.log('Detected sitemap index, fetching first sitemap');
      const result = await parseStringPromise(sitemapXml);
      if (result.sitemapindex && result.sitemapindex.sitemap) {
        // Get the first sitemap in the index
        const firstSitemapUrl = result.sitemapindex.sitemap[0].loc[0];
        console.log(`Fetching first sitemap from index: ${firstSitemapUrl}`);
        
        // Fetch the first sitemap
        const response = await axios.get(firstSitemapUrl, { 
          timeout: 15000,
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
          }
        });
        sitemapXml = response.data;
        console.log(`Fetched first sitemap, size: ${sitemapXml.length} bytes`);
      }
    }
    
    // Parse the sitemap XML
    const result = await parseStringPromise(sitemapXml);
    
    let formattedUrls = `Simple URL list from ${domain} sitemap:\n\n`;
    
    // Check if it's a valid sitemap with urlset and url properties
    if (result.urlset && result.urlset.url) {
      // Extract URLs
      const urls = result.urlset.url.map(url => url.loc[0].trim());
      console.log(`Found ${urls.length} URLs in sitemap`);
      
      // Create the numbered list
      urls.forEach((url, index) => {
        formattedUrls += `${index + 1}. ${url}\n`;
      });
      
      // Limit to 50 URLs to avoid overwhelming the API
      if (urls.length > 50) {
        console.log('Truncating URL list to 50 URLs');
        const truncatedUrls = formattedUrls.split('\n').slice(0, 52).join('\n');
        return truncatedUrls + '\n\n[List truncated to 50 URLs]';
      }
    } else {
      console.log('No valid URLs found in the sitemap');
      formattedUrls += "No valid URLs found in the sitemap.";
    }
    
    return formattedUrls;
  } catch (error) {
    console.error('Error extracting URLs from sitemap:', error.message);
    return `Error parsing sitemap for ${domain}: ${error.message}`;
  }
}

/**
 * Function to generate LLMs.txt content using Gemini with simplified URL list
 * @param {string} domain - The domain name
 * @param {string} sitemapXml - The raw sitemap XML content
 * @returns {Promise<string>} The generated LLMs.txt content
 */
async function generateLLMsTxtWithGemini(domain, sitemapXml) {
  try {
    // Convert the sitemap to a simple URL list format
    const formattedUrls = await extractAndFormatUrls(sitemapXml, domain);
    
    // Create the complete input text for Gemini - explicitly requesting markdown
    const completePrompt = "Generate a well-structured markdown document for an LLMs.txt file based on the following website URLs. The output MUST be in proper markdown format.\n\nInstructions:\n1. Understand & Validate Data:\n  - understand the URL list and extract unique, human-readable pages\n  - Avoid non-content pages like /login, /cart, /checkout, /admin, /wp-json, or any API endpoints.\n  - If the URL list is invalid or inaccessible, return an appropriate error message instead of generating fake data.\n\n2. Generate Structured Output: \n  - The file must begin with an H1 (#) containing the website name (either from metadata or inferred from the domain).\n  - Follow with a blockquote (>) summarizing the site based on the extracted content.\n  - Organize URLs into **meaningful sections** using H2 (##) headers (e.g., ## Blog, ## Products, ## Docs).\n  - Each URL should be formatted as - [Page Title](URL): and a description.\n  - If page titles are missing, generate concise, relevant ones based on the URL structure.\n\n3. Edge Cases & Enhancements: \n   - If the site has **no descriptive metadata**, generate a neutral summary instead of guessing.\n  - If the list contains external links, place them under an ## External Resources section.\n  - Include an ## Optional section for less essential pages that can be skipped if needed.\n\nOnly generate output when valid data is available. If issues arise, clearly state them in the response.\n\nHere are the website URLs to organize:\n\n" + formattedUrls;
    
    // Call Gemini API with the formatted URL list
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
    
    console.log('Sending request to Gemini API...');
    
    // Set a longer timeout promise - increase to 120 seconds for production
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Gemini API request timed out after 120 seconds')), 120000);
    });
    
    // Make the API call with a timeout
    const apiCallPromise = model.generateContent({
      contents: [
        {
          parts: [
            {
              text: completePrompt
            }
          ]
        }
      ],
      generationConfig: {
        temperature: 1.0,
        maxOutputTokens: 4000,
        topP: 1,
        topK: 1
      }
    }).catch(err => {
      console.error('Error in Gemini API call:', err.message);
      // Rethrow with more specific message
      throw new Error(`Gemini API error: ${err.message}`);
    });
    
    // Race the API call against the timeout
    const result = await Promise.race([apiCallPromise, timeoutPromise]);
    
    // Get the response text (markdown content)
    const markdownContent = result.response.text();
    console.log(`Received response from Gemini, length: ${markdownContent.length} characters`);
    
    // Ensure the response is in markdown format
    if (!markdownContent.includes('#')) {
      console.error('Response from Gemini does not appear to be in markdown format');
      throw new Error('Invalid response format from Gemini');
    }
    
    return markdownContent;
  } catch (error) {
    console.error('Error generating content with Gemini:', error);
    
    if (error.message.includes('timed out') || error.message.includes('socket close')) {
      console.log('Handling timeout or socket close error with fallback content');
    }
    
    // Fallback content if Gemini fails
    return `# LLMs.txt for ${domain}

## Permissions
- AI assistants may access and index content from this website for informational purposes.
- Please respect the website's robots.txt directives.

## Usage Guidelines
- Content may be used to provide information to users.
- Do not reproduce large portions of the content verbatim without attribution.

## Attribution
- When citing specific content, please include the domain name and URL.
- Example attribution: "According to ${domain}, ..."

## Restrictions
- Do not use content from this website to train AI models without explicit permission.
- Do not present the website's content as your own original analysis.
`;
  }
}

// Helper function to send emails with retry capability
async function sendEmailWithRetry(mailOptions, maxRetries = 3) {
  let attempts = 0;
  let lastError = null;
  
  while (attempts < maxRetries) {
    attempts++;
    try {
      console.log(`Email sending attempt ${attempts}/${maxRetries}...`);
      
      // Create a promise that will reject after timeout
      const emailPromise = transporter.sendMail(mailOptions);
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Email sending timed out after 40 seconds')), 40000)
      );
      
      // Race the email sending against the timeout
      const result = await Promise.race([emailPromise, timeoutPromise]);
      console.log(`Email sent successfully on attempt ${attempts}, messageId: ${result.messageId}`);
      return result; // Success!
    } catch (error) {
      lastError = error;
      console.error(`Email sending attempt ${attempts} failed:`, error.message);
      
      // Wait before retry with exponential backoff
      if (attempts < maxRetries) {
        const backoffTime = 2000 * Math.pow(2, attempts - 1); // 2s, 4s, 8s...
        console.log(`Retrying in ${backoffTime/1000} seconds...`);
        await new Promise(resolve => setTimeout(resolve, backoffTime));
      }
    }
  }
  
  // All retries failed
  console.error(`All ${maxRetries} email sending attempts failed`);
  throw new Error(`Email sending failed after ${maxRetries} attempts: ${lastError.message}`);
}

// Main endpoint to generate LLMs.txt and send email
app.post('/api/generate', async (req, res) => {
  // Wrap in try/catch to handle all errors
  try {
    const { email, domain } = req.body;
    
    // Validate inputs
    if (!email || !domain) {
      return res.status(400).json({ error: 'Email and domain are required' });
    }
    
    if (!email.includes('@') || !email.includes('.')) {
      return res.status(400).json({ error: 'Invalid email format' });
    }
    
    console.log(`Processing request for domain: ${domain}, email: ${email}`);
    
    // Generate a request ID for tracking
    const requestId = `req_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;
    console.log(`Request ID: ${requestId}`);
    
    // Step 1: Get the sitemap URL
    console.log(`[${requestId}] Getting sitemap for domain: ${domain}`);
    const sitemapUrl = await getSitemapUrl(domain);
    console.log(`[${requestId}] Sitemap URL: ${sitemapUrl || 'Not found'}`);
    
    let markdownContent = '';
    
    if (sitemapUrl) {
      // Step 2: Get the raw sitemap XML content
      console.log(`[${requestId}] Fetching sitemap content from: ${sitemapUrl}`);
      let sitemapXml;
      try {
        const response = await axios.get(sitemapUrl, { 
          timeout: 20000,  // Increase timeout to 20 seconds
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
          },
          maxContentLength: 10 * 1024 * 1024 // 10MB max
        });
        sitemapXml = response.data;
        console.log(`[${requestId}] Sitemap fetched, size: ${sitemapXml.length} bytes`);
      } catch (fetchError) {
        console.error(`[${requestId}] Error fetching sitemap:`, fetchError.message);
        // Use fallback if sitemap fetch fails
        throw new Error(`Failed to fetch sitemap: ${fetchError.message}`);
      }
      
      // Step 3: Generate LLMs.txt content using Gemini with simplified URL format
      console.log(`[${requestId}] Generating LLMs.txt content with Gemini...`);
      markdownContent = await generateLLMsTxtWithGemini(domain, sitemapXml);
      console.log(`[${requestId}] Generated content length: ${markdownContent.length} characters`);
    } else {
      // Fallback if no sitemap found
      console.log(`[${requestId}] No sitemap found, using fallback content`);
      markdownContent = `# LLMs.txt for ${domain}

## Permissions
- AI assistants may access and index content from this website for informational purposes.
- Please respect the website's robots.txt directives.

## Usage Guidelines
- Content may be used to provide information to users.
- Do not reproduce large portions of the content verbatim without attribution.

## Attribution
- When citing specific content, please include the domain name and URL.
- Example attribution: "According to ${domain}, ..."

## Restrictions
- Do not use content from this website to train AI models without explicit permission.
- Do not present the website's content as your own original analysis.
`;
    }
    
    // Step 4: Create a file with the markdown content
    // We're not writing to the filesystem, but creating a Buffer to attach to the email
    const fileBuffer = Buffer.from(markdownContent, 'utf-8');
    
    // Step 5: Send email with the generated content as a file attachment
    console.log(`[${requestId}] Sending email to: ${email}`);
    const mailOptions = {
      from: process.env.SENDER_EMAIL || "llmstxt@gmail.com",
      to: email,
      subject: `Your LLMs.txt file for ${domain}`,
      text: `Hello,

We've generated an LLMs.txt file for your website ${domain}. You can find it attached to this email.

To use this file, simply place it in the root directory of your website.

Best regards,
Garvit,`,
      attachments: [
        {
          filename: 'llms.txt',
          content: fileBuffer
        }
      ]
    };
    
    // Send the email with retry logic
    try {
      await sendEmailWithRetry(mailOptions, 3);
      console.log(`[${requestId}] Email sent successfully`);
    } catch (emailError) {
      console.error(`[${requestId}] All email sending attempts failed:`, emailError);
      throw new Error(`Email sending failed: ${emailError.message}`);
    }
    
    // Step 6: Return success response
    console.log(`[${requestId}] Request completed successfully`);
    return res.status(200).json({ 
      success: true, 
      message: 'LLMs.txt generated and sent successfully',
      requestId: requestId
    });
  } catch (error) {
    console.error('Error in /api/generate:', error);
    
    // Provide a more specific error message based on the error type
    let errorMessage = error.message || 'Unknown error';
    let errorDetails = 'Failed to generate LLMs.txt file';
    
    if (errorMessage.includes('timeout') || errorMessage.includes('socket')) {
      errorDetails = 'The request timed out. This might happen with larger websites. Please try again or try with a smaller domain.';
    } else if (errorMessage.includes('ENOTFOUND') || errorMessage.includes('ETIMEDOUT')) {
      errorDetails = `Could not connect to the domain ${req.body?.domain || 'provided'}. Please check that the domain is correct and accessible.`;
    } else if (errorMessage.includes('Email sending failed')) {
      errorDetails = 'We generated your file but could not send the email. Please check your email address and try again.';
    }
    
    return res.status(500).json({ error: errorDetails, details: errorMessage });
  }
});

// Newsletter subscription endpoint
app.post('/api/subscribe', async (req, res) => {
  try {
    const { email } = req.body;
    
    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }
    
    // Validate email format
    if (!email.includes('@') || !email.includes('.')) {
      return res.status(400).json({ error: 'Invalid email format' });
    }
    
    // Send confirmation email
    const mailOptions = {
      from: process.env.SENDER_EMAIL || "llmstxt@gmail.com",
      to: email,
      subject: "Welcome to the LLMs.txt Newsletter",
      text: `Hello,

Thank you for subscribing to the LLMs.txt newsletter!

You're now part of a forward-thinking community that's shaping how AI interacts with web content. We'll keep you informed about:

• Latest AI content protection strategies
• Updates to the LLMs.txt standard
• Expert tips for optimizing your website for AI systems
• Success stories from websites implementing LLMs.txt

If you have any questions, simply reply to this email.

Best regards,
Garvit,`,
      html: `
<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #333;">
  <header style="background: linear-gradient(135deg, #6C63FF, #5A52E0); padding: 20px; border-radius: 8px 8px 0 0; text-align: center;">
    <h1 style="color: white; margin: 0;">Welcome to the LLMs.txt Newsletter</h1>
  </header>
  
  <div style="padding: 20px; border: 1px solid #e1e1e1; border-top: none; border-radius: 0 0 8px 8px; background-color: white;">
    <p>Hello,</p>
    
    <p>Thank you for subscribing to the LLMs.txt newsletter!</p>
    
    <p>You're now part of a forward-thinking community that's shaping how AI interacts with web content. We'll keep you informed about:</p>
    
    <ul>
      <li>Latest AI content protection strategies</li>
      <li>Updates to the LLMs.txt standard</li>
      <li>Expert tips for optimizing your website for AI systems</li>
      <li>Success stories from websites implementing LLMs.txt</li>
    </ul>
    
    <p>If you have any questions, simply reply to this email.</p>
    
    <p>Best regards,<br>Garvit</p>
  </div>
</div>
`
    };
    
    // Send the email with retry logic
    try {
      await sendEmailWithRetry(mailOptions, 3);
      console.log(`Newsletter subscription email sent to: ${email}`);
    } catch (emailError) {
      console.error('Newsletter email sending failed:', emailError);
      throw new Error(`Newsletter email sending failed: ${emailError.message}`);
    }
    
    return res.status(200).json({ success: true, message: 'Subscription successful' });
  } catch (error) {
    console.error('Error processing newsletter subscription:', error);
    return res.status(500).json({ error: 'Failed to process subscription', details: error.message });
  }
});

// Route for the home page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Simple health check endpoint
app.get('/health', (req, res) => {
  return res.status(200).json({ status: 'ok', uptime: process.uptime() });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error', details: err.message });
});

// Start the server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Visit http://localhost:${PORT} in your browser`);
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  // Application specific logging
});

// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
  // Application specific logging
});