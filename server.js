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
  apiKey: process.env.OPENAI_API_KEY || 'sk-dummy-key-replace-with-actual-key'
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

// Function to parse sitemap and extract URLs
async function parseSitemap(sitemapUrl) {
  try {
    const response = await axios.get(sitemapUrl, { timeout: 10000 });
    const xmlData = response.data;
    
    // Check if it's a sitemap or sitemap index
    if (xmlData.includes('<sitemapindex')) {
      // Handle sitemap index
      const result = await parseStringPromise(xmlData);
      if (result.sitemapindex && result.sitemapindex.sitemap) {
        const sitemaps = result.sitemapindex.sitemap.map(sitemap => sitemap.loc[0]);
        
        // Get the first sitemap in the index
        if (sitemaps.length > 0) {
          return parseSitemap(sitemaps[0]);
        }
      }
      return [];
    } else {
      // Regular sitemap
      const result = await parseStringPromise(xmlData);
      
      // Check if urlset and url properties exist
      if (result.urlset && result.urlset.url) {
        // Extract URLs from the sitemap
        const urls = result.urlset.url.map(url => ({
          loc: url.loc[0],
          lastmod: url.lastmod ? url.lastmod[0] : null,
          priority: url.priority ? url.priority[0] : null
        }));
        
        return urls.slice(0, 30); // Limit to 30 URLs to avoid overwhelming the API
      }
      return [];
    }
  } catch (error) {
    console.error('Error parsing sitemap:', error.message);
    return [];
  }
}

// Function to generate LLMs.txt content using OpenAI
async function generateLLMsTxtWithOpenAI(domain, sitemapData) {
  try {
    // Create a structured summary of the sitemap data
    let sitemapSummary = `Domain: ${domain}\n\nTop URLs:\n`;
    
    if (sitemapData && sitemapData.length > 0) {
      sitemapData.forEach((item, index) => {
        if (index < 15) { // Only include top 15 URLs to avoid token limits
          sitemapSummary += `${index + 1}. ${item.loc}\n`;
        }
      });
    } else {
      sitemapSummary += "No sitemap data available.";
    }
    
    // Prompt for OpenAI
    const prompt = `
    You are an expert in creating LLMs.txt files for websites. An LLMs.txt file provides instructions to AI assistants about how to interact with content from a website.
    
    Based on the following website information, create a comprehensive LLMs.txt file:
    
    ${sitemapSummary}
    
    The LLMs.txt file should include:
    1. Clear permissions for AI crawling and indexing
    2. Usage guidelines for the website's content
    3. Areas of the site that should be emphasized or de-emphasized
    4. Any copyright or attribution requirements
    5. Appropriate tone and context for referencing the website's content
    
    Format the response in proper markdown with clear sections.
    `;
    
    // Call OpenAI API
    const response = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        {
          role: "system",
          content: "You are an AI assistant that creates LLMs.txt files for websites based on their sitemap data."
        },
        {
          role: "user",
          content: prompt
        }
      ],
      temperature: 0.7,
      max_tokens: 1200
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
      // Step 2: Parse the sitemap to get URLs
      const sitemapData = await parseSitemap(sitemapUrl);
      console.log(`Parsed ${sitemapData.length} URLs from sitemap`);
      
      // Step 3: Generate LLMs.txt content using OpenAI
      llmsContent = await generateLLMsTxtWithOpenAI(domain, sitemapData);
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