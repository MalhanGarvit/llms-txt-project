require('dotenv').config();
const express = require('express');
const nodemailer = require('nodemailer');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware to parse incoming form data
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static files from the 'public' folder
app.use(express.static(path.join(__dirname, 'public')));

// Set up Nodemailer transporter using Gmail SMTP
const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST,
  port: Number(process.env.EMAIL_PORT),
  secure: process.env.EMAIL_SECURE === 'true', // Must be true for port 465
  auth: {
    user: "garvitmalhanpcellaryabhatta@gmail.com",
    pass: "hcva vudd kkes vwhv"
  }
});

// Endpoint to handle form submissions and email the generated llms.txt file
app.post('/api/sendEmail', async (req, res) => {
  try {
    const { email, inputType, sitemapUrl, manualContent } = req.body;
    let llmsTextContent = '';

    if (inputType === 'sitemapUrl') {
      // Generate llms.txt in the correct spec structure
      llmsTextContent = `# ${new URL(sitemapUrl).hostname} Documentation

> Auto-generated documentation for ${sitemapUrl}. This file provides key insights about the project.

Below are sections detailing the structure and resources of the site.

## Core Documentation

- [Home](${sitemapUrl}/home): Overview of the site
- [Blog](${sitemapUrl}/blog): Latest articles and updates

## Additional Resources

- [About](${sitemapUrl}/about): Learn more about the team
- [Contact](${sitemapUrl}/contact): Reach out to us
`;
    } else if (inputType === 'manualContent') {
      // Generate llms.txt using user-provided content
      llmsTextContent = `# Custom Documentation

> Auto-generated documentation based on your provided content.

${manualContent}

## Additional Details

- [Optional Link](https://example.com): Further reading or reference
`;
    } else {
      return res.status(400).json({ error: 'Invalid input type' });
    }

    // Prepare the email with the llms.txt file attached
    const mailOptions = {
      from: process.env.SENDER_EMAIL,
      to: email,
      subject: 'Your Generated llms.txt File',
      text: 'Please find attached your generated llms.txt file.',
      attachments: [
        {
          filename: 'llms.txt',
          content: llmsTextContent
        }
      ]
    };

    // Send the email
    const info = await transporter.sendMail(mailOptions);
    console.log('Email sent:', info.response);
    res.json({ message: 'Email sent successfully', content: llmsTextContent });

  } catch (error) {
    console.error('Error sending email:', error);
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
