require('dotenv').config();
const express = require('express');
const nodemailer = require('nodemailer');
const path = require('path');
const axios = require('axios');
const { parseStringPromise } = require('xml2js');
const OpenAI = require('openai');

const app = express();
const PORT = process.env.PORT || 3000;

// Initialize OpenAI with API key from environment variables
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || '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'
});

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
      console.log(`Sitemap not found at ${url}`);
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
    console.log('No robots.txt or sitemap reference found');
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
        console.log(`Found sitemap index, fetching first sitemap: ${firstSitemapUrl}`);
        
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
 * Function to generate LLMs.txt content using OpenAI with simplified URL list
 * @param {string} domain - The domain name
 * @param {string} sitemapXml - The raw sitemap XML content
 * @returns {Promise<string>} The generated LLMs.txt content
 */
async function generateLLMsTxtWithOpenAI(domain, sitemapXml) {
  try {
    // Convert the sitemap to a simple URL list format
    const formattedUrls = await extractAndFormatUrls(sitemapXml, domain);
    console.log('Formatted URLs to send to OpenAI:');
    console.log(formattedUrls);
    
    // Call OpenAI API with the formatted URL list
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: "You are an AI assistant that generates a structured `llms.txt` file in Markdown format from a given list of URLs. The goal is to create a well-organized, useful file for LLMs to understand the website content effectively.  \n\nInstructions:  \n1. Understand & Validate Data:\n  - understand the URL list and extract unique, human-readable pages\n  - Avoid non-content pages like `/login`, `/cart`, `/checkout`, `/admin`, `/wp-json`, or any API endpoints.  \n  - If the URL list is invalid or inaccessible, return an appropriate error message instead of generating fake data.  \n\n2. Generate Structured Output: \n  - The file must begin with an H1 (`#`) containing the website name (either from metadata or inferred from the domain).  \n  - Follow with a blockquote (`>`) summarizing the site based on the extracted content.  \n  - Organize URLs into **meaningful sections** using H2 (`##`) headers (e.g., `## Blog`, `## Products`, `## Docs`).  \n  - Each URL should be formatted as `- [Page Title](URL): Optional description`.  \n  - If page titles are missing, generate concise, relevant ones based on the URL structure.  \n\n3. Edge Cases & Enhancements: \n   - If the site has **no descriptive metadata**, generate a neutral summary instead of guessing.  \n  - If the list contains external links, place them under an `## External Resources` section.  \n  - Include an `## Optional` section for less essential pages that can be skipped if needed.  \n\nOnly generate output when valid data is available. If issues arise, clearly state them in the response."
        },
        {
          role: "user",
          content: formattedUrls
        }
      ],
      temperature: 1,
      max_tokens: 4000,
      top_p: 1,
      frequency_penalty: 0,
      presence_penalty: 0
    });
    
    // Return the AI-generated content
    return response.choices[0].message.content;
  } catch (error) {
    console.error('Error generating content with OpenAI:', error);
    
    // Fallback content if OpenAI fails
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
    
    console.log(`Processing request for email: ${email}, domain: ${domain}`);
    
    // Step 1: Get the sitemap URL
    const sitemapUrl = await getSitemapUrl(domain);
    console.log(`Sitemap URL found: ${sitemapUrl || 'None'}`);
    
    let llmsContent = '';
    
    if (sitemapUrl) {
      // Step 2: Get the raw sitemap XML content
      const response = await axios.get(sitemapUrl, { timeout: 10000 });
      const sitemapXml = response.data;
      
      // Step 3: Generate LLMs.txt content using OpenAI with simplified URL format
      llmsContent = await generateLLMsTxtWithOpenAI(domain, sitemapXml);
    } else {
      console.log('No sitemap found, using fallback content');
      // Fallback if no sitemap found
      llmsContent = `# LLMs.txt for ${domain}

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
    
    // Step 4: Send email with the generated content
    const mailOptions = {
      from: process.env.SENDER_EMAIL || "llmstxt@gmail.com",
      to: email,
      subject: `Your LLMs.txt file for ${domain}`,
      text: `Hello,

We've generated an LLMs.txt file for your website ${domain}. You can find it attached to this email.

To use this file, simply place it in the root directory of your website.

Best regards,
LLMs.txt Generator Team`,
      attachments: [
        {
          filename: 'llms.txt',
          content: llmsContent
        }
      ]
    };
    
    console.log('Sending email...');
    
    // Send the email
    await transporter.sendMail(mailOptions);
    console.log('Email sent successfully');
    
    // Step 5: Return success response
    return res.status(200).json({ success: true, message: 'LLMs.txt generated and sent successfully' });
  } catch (error) {
    console.error('Error generating LLMs.txt:', error);
    return res.status(500).json({ error: 'Failed to generate LLMs.txt file', details: error.message });
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
