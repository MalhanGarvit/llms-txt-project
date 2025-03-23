require('dotenv').config();
const express = require('express');
const SibApiV3Sdk = require('@getbrevo/brevo');
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

// Set up Brevo API
let brevoClient = new SibApiV3Sdk.TransactionalEmailsApi();
let apiKey = brevoClient.authentications['apiKey'];
apiKey.apiKey = process.env.BREVO_API_KEY;
if (!process.env.BREVO_API_KEY) {
  console.error("ERROR: BREVO_API_KEY environment variable is not set. Please set it in your .env file.");
}

// Middleware to parse incoming data
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static files from the public directory
app.use(express.static('public'));

// Function to get sitemap URL from domain
async function getSitemapUrl(domain) {
  // Clean up domain (remove http/https if present)
  let cleanDomain = domain;
  if (cleanDomain.startsWith('http://')) {
    cleanDomain = cleanDomain.substring(7);
  } else if (cleanDomain.startsWith('https://')) {
    cleanDomain = cleanDomain.substring(8);
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
      const response = await axios.get(url, { timeout: 5000 });
      if (response.status === 200) {
        return url;
      }
    } catch (error) {
      // Continue to next location
    }
  }
  
  // If no sitemap found, try robots.txt for sitemap reference
  try {
    const robotsUrl = `https://${cleanDomain}/robots.txt`;
    const response = await axios.get(robotsUrl, { timeout: 5000 });
    
    if (response.status === 200) {
      const robotsContent = response.data;
      const sitemapMatch = robotsContent.match(/Sitemap:\s*(\S+)/i);
      
      if (sitemapMatch && sitemapMatch[1]) {
        return sitemapMatch[1];
      }
    }
  } catch (error) {
    // No robots.txt or sitemap reference found
  }
  
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
    // Check if it's a sitemap index
    if (sitemapXml.includes('<sitemapindex')) {
      const result = await parseStringPromise(sitemapXml);
      if (result.sitemapindex && result.sitemapindex.sitemap) {
        // Get the first sitemap in the index
        const firstSitemapUrl = result.sitemapindex.sitemap[0].loc[0];
        
        // Fetch the first sitemap
        const response = await axios.get(firstSitemapUrl, { timeout: 10000 });
        sitemapXml = response.data;
      }
    }
    
    // Parse the sitemap XML
    const result = await parseStringPromise(sitemapXml);
    
    let formattedUrls = `Simple URL list from ${domain} sitemap:\n\n`;
    
    // Check if it's a valid sitemap with urlset and url properties
    if (result.urlset && result.urlset.url) {
      // Extract URLs
      const urls = result.urlset.url.map(url => url.loc[0].trim());
      
      // Create the numbered list
      urls.forEach((url, index) => {
        formattedUrls += `${index + 1}. ${url}\n`;
      });
      
      // Limit to 50 URLs to avoid overwhelming the API
      if (urls.length > 50) {
        const truncatedUrls = formattedUrls.split('\n').slice(0, 52).join('\n');
        return truncatedUrls + '\n\n[List truncated to 50 URLs]';
      }
    } else {
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
    const completePrompt = "Generate a well-structured markdown document for an LLMs.txt file based on the following website URLs. The output MUST be in proper markdown format.\n\nInstructions:\n1. Understand & Validate Data:\n  - understand the URL list and extract unique, human-readable pages\n  - Avoid non-content pages like `/login`, `/cart`, `/checkout`, `/admin`, `/wp-json`, or any API endpoints.\n  - If the URL list is invalid or inaccessible, return an appropriate error message instead of generating fake data.\n\n2. Generate Structured Output: \n  - The file must begin with an H1 (`#`) containing the website name (either from metadata or inferred from the domain).\n  - Follow with a blockquote (`>`) summarizing the site based on the extracted content.\n  - Organize URLs into **meaningful sections** using H2 (`##`) headers (e.g., `## Blog`, `## Products`, `## Docs`).\n  - Each URL should be formatted as `- [Page Title](URL): and a description`.\n  - If page titles are missing, generate concise, relevant ones based on the URL structure.\n\n3. Edge Cases & Enhancements: \n   - If the site has **no descriptive metadata**, generate a neutral summary instead of guessing.\n  - If the list contains external links, place them under an `## External Resources` section.\n  - Include an `## Optional` section for less essential pages that can be skipped if needed.\n\nOnly generate output when valid data is available. If issues arise, clearly state them in the response.\n\nHere are the website URLs to organize:\n\n" + formattedUrls;
    
    // Call Gemini API with the formatted URL list
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-pro" });
    
    const result = await model.generateContent({
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
    });
    
    // Get the response text (markdown content)
    const markdownContent = result.response.text();
    
    // Ensure the response is in markdown format
    if (!markdownContent.includes('#')) {
      console.error('Response from Gemini does not appear to be in markdown format');
      throw new Error('Invalid response format from Gemini');
    }
    
    return markdownContent;
  } catch (error) {
    console.error('Error generating content with Gemini:', error);
    
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

// Main endpoint to generate LLMs.txt and send email
app.post('/api/generate', async (req, res) => {
  try {
    const { email, domain } = req.body;
    
    if (!email || !domain) {
      return res.status(400).json({ error: 'Email and domain are required' });
    }
    
    // Step 1: Get the sitemap URL
    const sitemapUrl = await getSitemapUrl(domain);
    
    let markdownContent = '';
    
    if (sitemapUrl) {
      // Step 2: Get the raw sitemap XML content
      const response = await axios.get(sitemapUrl, { timeout: 10000 });
      const sitemapXml = response.data;
      
      // Step 3: Generate LLMs.txt content using Gemini with simplified URL format
      markdownContent = await generateLLMsTxtWithGemini(domain, sitemapXml);
    } else {
      // Fallback if no sitemap found
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
    // Create a new SendSmtpEmail instance
    let sendSmtpEmail = new SibApiV3Sdk.SendSmtpEmail();
    
    sendSmtpEmail.subject = `Your LLMs.txt file for ${domain}`;
    sendSmtpEmail.htmlContent = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #333;">
      <p>Hello,</p>
      
      <p>We've generated an LLMs.txt file for your website ${domain}. You can find it attached to this email.</p>
      
      <p>To use this file, simply place it in the root directory of your website.</p>
      
      <p>Best regards,<br>Garvit</p>
    </div>`;
    sendSmtpEmail.sender = { "name": "LLMs.txt Generator", "email": process.env.SENDER_EMAIL || "llmstxt@gmail.com" };
    sendSmtpEmail.to = [{ "email": email }];
    sendSmtpEmail.attachment = [{
      "content": fileBuffer.toString('base64'),
      "name": "llms.txt"
    }];
    
    // Send the email with Brevo
    await brevoClient.sendTransacEmail(sendSmtpEmail);
    
    // Step 6: Return success response
    return res.status(200).json({ success: true, message: 'LLMs.txt generated and sent successfully' });
  } catch (error) {
    console.error('Error generating LLMs.txt:', error);
    return res.status(500).json({ error: 'Failed to generate LLMs.txt file', details: error.message });
  }
});

// Newsletter subscription endpoint
app.post('/api/subscribe', async (req, res) => {
  try {
    const { email } = req.body;
    
    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }
    
    // Create a new SendSmtpEmail instance for newsletter subscription
    let sendSmtpEmail = new SibApiV3Sdk.SendSmtpEmail();
    
    sendSmtpEmail.subject = "Welcome to the LLMs.txt Newsletter";
    sendSmtpEmail.htmlContent = `
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
    </div>`;
    sendSmtpEmail.sender = { "name": "LLMs.txt Generator", "email": process.env.SENDER_EMAIL || "llmstxt@gmail.com" };
    sendSmtpEmail.to = [{ "email": email }];
    
    // Send the email with Brevo
    await brevoClient.sendTransacEmail(sendSmtpEmail);
    
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

// Start the server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Visit http://localhost:${PORT} in your browser`);
});