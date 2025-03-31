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

// Set up Nodemailer transporter using Gmail SMTP
const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST || 'smtp.gmail.com',
  port: Number(process.env.EMAIL_PORT || 465),
  secure: process.env.EMAIL_SECURE === 'true', // true for 465
  auth: {
    user: process.env.EMAIL_USER || "llmstxt@gmail.com",
    pass: process.env.EMAIL_PASS || "eeng nhqv dyit ddhz"
  }
});

// Function to get all sitemap URLs from domain
async function getSitemapUrls(domain) {
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
  
  let sitemapUrls = [];
  
  // Try to find sitemaps in robots.txt first (preferred method)
  try {
    const robotsUrl = `https://${cleanDomain}/robots.txt`;
    const response = await axios.get(robotsUrl, { timeout: 5000 });
    
    if (response.status === 200) {
      const robotsContent = response.data;
      // Extract all sitemap references using regex
      const sitemapMatches = robotsContent.match(/Sitemap:\s*(\S+)/gi);
      
      if (sitemapMatches && sitemapMatches.length > 0) {
        // Process each match and extract the URL
        sitemapMatches.forEach(match => {
          const url = match.replace(/Sitemap:\s*/i, '').trim();
          sitemapUrls.push(url);
        });
        
        return sitemapUrls;
      }
    }
  } catch (error) {
    console.log(`No robots.txt found for ${cleanDomain} or error accessing it:`, error.message);
  }
  
  // If no sitemaps found in robots.txt, try common sitemap locations
  if (sitemapUrls.length === 0) {
    const possibleLocations = [
      `https://${cleanDomain}/sitemap.xml`,
      `https://${cleanDomain}/sitemap_index.xml`,
      `https://${cleanDomain}/sitemap.php`,
      `https://${cleanDomain}/sitemap.txt`,
      `https://${cleanDomain}/wp-sitemap.xml`,
      `https://${cleanDomain}/blog/sitemap.xml`
    ];
    
    for (const url of possibleLocations) {
      try {
        const response = await axios.get(url, { timeout: 5000 });
        if (response.status === 200) {
          sitemapUrls.push(url);
        }
      } catch (error) {
        // Continue to next location
      }
    }
  }
  
  return sitemapUrls.length > 0 ? sitemapUrls : null;
}

// Process sitemap XML recursively to extract all URLs
async function processAllSitemaps(sitemapUrl, processedUrls = new Set(), urlsList = [], maxUrls = 250, depth = 0, maxDepth = 3) {
  // Prevent infinite recursion or excessive nesting
  if (depth > maxDepth) {
    console.log(`Maximum sitemap depth (${maxDepth}) reached at ${sitemapUrl}`);
    return urlsList;
  }
  
  // Skip if we've already processed this sitemap
  if (processedUrls.has(sitemapUrl)) {
    return urlsList;
  }
  
  processedUrls.add(sitemapUrl);
  console.log(`Processing sitemap: ${sitemapUrl} (depth: ${depth})`);
  
  try {
    // Fetch the sitemap content
    const response = await axios.get(sitemapUrl, { timeout: 10000 });
    const sitemapXml = response.data;
    
    // Parse the sitemap XML
    const result = await parseStringPromise(sitemapXml);
    
    // Check if this is a sitemap index
    if (result.sitemapindex && result.sitemapindex.sitemap) {
      console.log(`Found sitemap index with ${result.sitemapindex.sitemap.length} sitemaps`);
      
      // Process each nested sitemap
      for (const sitemap of result.sitemapindex.sitemap) {
        const nestedSitemapUrl = sitemap.loc[0].trim();
        
        // Skip if we've already processed this nested sitemap
        if (processedUrls.has(nestedSitemapUrl)) {
          continue;
        }
        
        // Recursively process the nested sitemap
        await processAllSitemaps(nestedSitemapUrl, processedUrls, urlsList, maxUrls, depth + 1, maxDepth);
        
        // Stop if we've reached our max URLs limit
        if (urlsList.length >= maxUrls) {
          break;
        }
      }
    } 
    // Check if this is a regular sitemap with URLs
    else if (result.urlset && result.urlset.url) {
      // Extract URLs from this sitemap
      const newUrls = result.urlset.url.map(url => url.loc[0].trim());
      console.log(`Found ${newUrls.length} URLs in sitemap`);
      
      // Add unique URLs up to the maximum limit
      for (const url of newUrls) {
        if (!urlsList.includes(url) && urlsList.length < maxUrls) {
          urlsList.push(url);
        }
        
        if (urlsList.length >= maxUrls) {
          break;
        }
      }
    } else {
      console.log(`Sitemap format not recognized: ${sitemapUrl}`);
    }
    
    return urlsList;
  } catch (error) {
    console.error(`Error processing sitemap ${sitemapUrl}:`, error.message);
    return urlsList;
  }
}

// Main function to extract all URLs from all sitemaps for a domain
async function getAllSitemapUrls(domain, maxUrls = 250) {
  try {
    // Get all sitemap URLs for the domain
    const sitemapUrls = await getSitemapUrls(domain);
    
    if (!sitemapUrls || sitemapUrls.length === 0) {
      console.log(`No sitemaps found for ${domain}`);
      return [];
    }
    
    console.log(`Found ${sitemapUrls.length} sitemaps for ${domain}:`, sitemapUrls);
    
    // Process all sitemaps and collect unique URLs
    const processedUrls = new Set();
    let allUrls = [];
    
    for (const sitemapUrl of sitemapUrls) {
      const results = await processAllSitemaps(sitemapUrl, processedUrls, [], maxUrls);
      
      // Add unique URLs from this sitemap
      for (const url of results) {
        if (!allUrls.includes(url) && allUrls.length < maxUrls) {
          allUrls.push(url);
        }
        
        if (allUrls.length >= maxUrls) {
          break;
        }
      }
      
      if (allUrls.length >= maxUrls) {
        break;
      }
    }
    
    return allUrls;
  } catch (error) {
    console.error(`Error getting all sitemap URLs for ${domain}:`, error.message);
    return [];
  }
}

// Function to format URLs into a structured list
function formatUrlsList(urls, domain, maxUrls = 250) {
  let formattedUrls = `URL list from ${domain} sitemap:\n\n`;
  
  if (urls.length === 0) {
    return formattedUrls + "No valid URLs found in the sitemaps.";
  }
  
  // Create the numbered list
  urls.forEach((url, index) => {
    formattedUrls += `${index + 1}. ${url}\n`;
  }); 
  return formattedUrls;
}

/**
 * Function to generate LLMs.txt content using Gemini with formatted URL list
 * @param {string} domain - The domain name
 * @param {string} formattedUrls - The formatted list of URLs
 * @returns {Promise<string>} The generated LLMs.txt content
 */
async function generateLLMsTxtWithGemini(domain, formattedUrls) {
  try {
    // Create the complete input text for Gemini - explicitly requesting markdown
    const completePrompt = "Generate a well-structured markdown document for an LLMs.txt file based on the following website URLs. The output MUST be in proper markdown format.\n\nInstructions:\n1. Understand & Validate Data:\n  - understand the URL list and extract unique, human-readable pages\n  - Avoid non-content pages like `/login`, `/cart`, `/checkout`, `/admin`, `/wp-json`, or any API endpoints.\n  - If the URL list is invalid or inaccessible, return an appropriate error message instead of generating fake data.\n\n2. Generate Structured Output: \n  - The file must begin with an H1 (`#`) containing the website name (either from metadata or inferred from the domain).\n  - Follow with a blockquote (`>`) summarizing the site based on the extracted content.\n  - Organize URLs into **meaningful sections** using H2 (`##`) headers (e.g., `## Blog`, `## Products`, `## Docs`).\n  - Each URL should be formatted as `- [Page Title](URL): and a description`.\n  - If page titles are missing, generate concise, relevant ones based on the URL structure.\n\n3. Edge Cases & Enhancements: \n   - If the site has **no descriptive metadata**, generate a neutral summary instead of guessing.\n  - If the list contains external links, place them under an `## External Resources` section.\n  - Include an `## Optional` section for less essential pages that can be skipped if needed but try to generate for all the urls provided to you in the input\n\nOnly generate output when valid data is available. If issues arise, clearly state them in the response.\n\nJust give the mardown output nothing else\n\nWrite a nice 4-5 liner H1 description about the domain\n\nHere are the website URLs to organize:\n\n" + formattedUrls;
    
    // Call Gemini API with the formatted URL list
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
    
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
        maxOutputTokens: 12000,
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
    
    console.log(`Processing request for domain: ${domain}`);
    
    // Step 1: Extract all URLs from all sitemaps
    const allUrls = await getAllSitemapUrls(domain);
    let markdownContent = '';
    
    if (allUrls && allUrls.length > 0) {
      console.log(`Found ${allUrls.length} URLs from sitemaps for ${domain}`);
      
      // Format URLs into a structured list
      const formattedUrls = formatUrlsList(allUrls, domain);
      
      // Step 2: Generate LLMs.txt content using Gemini with the formatted URL list
      markdownContent = await generateLLMsTxtWithGemini(domain, formattedUrls);
    } else {
      console.log(`No URLs found for ${domain}, using fallback content`);
      
      // Fallback if no URLs found
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
    
    // Step 3: Create a file with the markdown content
    const fileBuffer = Buffer.from(markdownContent, 'utf-8');
    
    // Step 4: Send email with the generated content as a file attachment
    const mailOptions = {
      from: process.env.SENDER_EMAIL || "llmstxt@gmail.com",
      to: email,
      subject: `Your LLMs.txt file for ${domain}`,
      text: `Hello,

We've generated an LLMs.txt file for your website ${domain}, which is attached to this email.

To implement this file, simply place it in your website's root directory. If you're a marketer and would like free assistance in adding it to your site, please reply to this email and our team will gladly help at no cost.

Congratulations on taking a significant step towards improving your ranking on AI engines like ChatGPT and Claude!

Best regards,
Garvit`,
      attachments: [
        {
          filename: 'llms.txt',
          content: fileBuffer
        }
      ]
    };
    
    // Send the email
    await transporter.sendMail(mailOptions);
    
    // Step 5: Return success response
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
Garvit`,
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
    
    // Send the email
    await transporter.sendMail(mailOptions);
    
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
