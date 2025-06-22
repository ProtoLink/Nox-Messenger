const http = require("http");
const express = require("express");
const fs = require("fs");
const path = require("path");
const app = express();

app.use(express.static("public"));
// require("dotenv").config();

// Load configuration
const config = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));

const serverPort = config.server.port;
const server = http.createServer(app);
const WebSocket = require("ws");

let keepAliveId;
let messageHistory = [];
const MAX_MESSAGES = config.messageHistory.maxMessages;
const MESSAGES_FILE = path.join(__dirname, config.messageHistory.filename);

const wss = new WebSocket.Server({ 
  server,
  path: config.websocket.path
});

server.listen(serverPort, config.server.host);
console.log(`Server started on port ${serverPort} with WebSocket endpoint at ${config.websocket.path}`);

wss.on("connection", function (ws, req) {
  console.log("Connection Opened");
  console.log("Client size: ", wss.clients.size);

  /*
  if (wss.clients.size === 1) {
    console.log("first connection. starting keepalive");
    keepServerAlive();
  }
*/
  ws.on("message", (data) => {
    let stringifiedData = data.toString();
    if (stringifiedData === 'pong') {
      console.log('keepAlive');
      return;
    }
    
    // Store message in history
    const messageData = {
      timestamp: new Date().toISOString(),
      message: stringifiedData,
      clientId: req.socket.remoteAddress + ':' + req.socket.remotePort
    };
    
    messageHistory.push(messageData);
    
    // Keep only the latest 30 messages
    if (messageHistory.length > MAX_MESSAGES) {
      messageHistory.shift();
    }
    
    // Save to JSON file
    saveMessagesToFile();
    
    broadcast(ws, stringifiedData, true);
  });

  ws.on("close", (data) => {
    console.log("closing connection");

    if (wss.clients.size === 0) {
      console.log("last client disconnected, stopping keepAlive interval");
      clearInterval(keepAliveId);
    }
  });
});

// Implement broadcast function because of ws doesn't have it
const broadcast = (ws, message, includeSelf) => {
  if (includeSelf) {
    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    });
  } else {
    wss.clients.forEach((client) => {
      if (client !== ws && client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    });
  }
};

/**
 * Saves message history to JSON file
 */
const saveMessagesToFile = () => {
  if (!config.messageHistory.saveToFile) return;
  
  try {
    fs.writeFileSync(MESSAGES_FILE, JSON.stringify(messageHistory, null, 2));
  } catch (error) {
    console.error('Error saving messages to file:', error);
  }
};

/**
 * Loads message history from JSON file on startup
 */
const loadMessagesFromFile = () => {
  try {
    if (fs.existsSync(MESSAGES_FILE)) {
      const data = fs.readFileSync(MESSAGES_FILE, 'utf8');
      messageHistory = JSON.parse(data);
      console.log(`Loaded ${messageHistory.length} messages from file`);
    }
  } catch (error) {
    console.error('Error loading messages from file:', error);
    messageHistory = [];
  }
};

// Load existing messages from file
loadMessagesFromFile();

/**
 * Sends a ping message to all connected clients based on config interval
 */
 const keepServerAlive = () => {
  keepAliveId = setInterval(() => {
    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send('ping');
      }
    });
  }, config.websocket.keepAliveInterval);
};


app.get('/', (req, res) => {
    res.send('Hello World!');
});

app.get('/history', (req, res) => {
    try {
        // Return each message as a separate line in the response
        const messages = messageHistory.map(msg => msg.message).join('\n');
        res.type('text/plain');
        res.send(messages);
    } catch (error) {
        console.error('Error retrieving message history:', error);
        res.status(500).send('Error retrieving message history');
    }
});
