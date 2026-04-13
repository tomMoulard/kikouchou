#!/usr/bin/env node

/**
 * Minimal y-webrtc-compatible signaling server.
 *
 * Based on https://github.com/yjs/y-webrtc/blob/master/bin/server.js
 * Rooms are ephemeral, in-memory only. No storage, no auth, no logging
 * of message content. Messages are forwarded as-is between peers.
 */

import { WebSocketServer } from 'ws';
import http from 'http';

const wsReadyStateConnecting = 0;
const wsReadyStateOpen = 1;

const pingTimeout = 30000;
const port = process.env.PORT || 4444;

const wss = new WebSocketServer({ noServer: true });

const server = http.createServer((_req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('ok');
});

/** @type {Map<string, Set<WebSocket>>} */
const topics = new Map();

/** @param {WebSocket} conn  @param {object} message */
const send = (conn, message) => {
  if (
    conn.readyState !== wsReadyStateConnecting &&
    conn.readyState !== wsReadyStateOpen
  ) {
    conn.close();
    return;
  }
  try {
    conn.send(JSON.stringify(message));
  } catch {
    conn.close();
  }
};

/** @param {WebSocket} conn */
const onconnection = (conn) => {
  /** @type {Set<string>} */
  const subscribedTopics = new Set();
  let closed = false;

  // Ping/pong keepalive every 30s
  let pongReceived = true;
  const pingInterval = setInterval(() => {
    if (!pongReceived) {
      conn.close();
      clearInterval(pingInterval);
    } else {
      pongReceived = false;
      try {
        conn.ping();
      } catch {
        conn.close();
      }
    }
  }, pingTimeout);

  conn.on('pong', () => {
    pongReceived = true;
  });

  conn.on('close', () => {
    subscribedTopics.forEach((topicName) => {
      const subs = topics.get(topicName);
      if (subs) {
        subs.delete(conn);
        if (subs.size === 0) {
          topics.delete(topicName);
        }
      }
    });
    subscribedTopics.clear();
    closed = true;
    clearInterval(pingInterval);
  });

  conn.on('message', (raw) => {
    let message;
    try {
      message = JSON.parse(typeof raw === 'string' ? raw : raw.toString());
    } catch {
      return;
    }
    if (!message || !message.type || closed) return;

    switch (message.type) {
      case 'subscribe':
        (message.topics || []).forEach((topicName) => {
          if (typeof topicName !== 'string') return;
          let topic = topics.get(topicName);
          if (!topic) {
            topic = new Set();
            topics.set(topicName, topic);
          }
          topic.add(conn);
          subscribedTopics.add(topicName);
        });
        break;

      case 'unsubscribe':
        (message.topics || []).forEach((topicName) => {
          const subs = topics.get(topicName);
          if (subs) {
            subs.delete(conn);
            if (subs.size === 0) {
              topics.delete(topicName);
            }
          }
        });
        break;

      case 'publish':
        if (message.topic) {
          const receivers = topics.get(message.topic);
          if (receivers) {
            receivers.forEach((receiver) => send(receiver, message));
          }
        }
        break;

      case 'ping':
        send(conn, { type: 'pong' });
        break;
    }
  });
};

wss.on('connection', onconnection);

server.on('upgrade', (request, socket, head) => {
  wss.handleUpgrade(request, socket, head, (ws) => {
    wss.emit('connection', ws, request);
  });
});

server.listen(port, () => {
  console.log(`y-webrtc signaling server running on port ${port}`);
});
