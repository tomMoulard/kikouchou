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

/**
 * Signaling frames carry SDP/ICE and small encrypted announces. `ws` defaults
 * to a 100 MiB maxPayload, which lets one client force an O(subscribers)
 * fan-out of a huge buffer through a single-threaded event loop.
 */
const maxPayload = 128 * 1024;

/** Bounds the in-memory topic map: one client cannot allocate unbounded keys. */
const maxTopicsPerConnection = 50;

/** Longest accepted topic name — room ids are nanoid(12). */
const maxTopicLength = 256;

const wss = new WebSocketServer({ noServer: true, maxPayload });

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

/**
 * Coerces an untrusted `topics` field into a list of usable topic names.
 *
 * `(message.topics || []).forEach(...)` throws on any truthy non-array, so a
 * single `{"type":"subscribe","topics":42}` frame used to be a remote kill
 * switch for the whole relay.
 *
 * @param {unknown} value
 * @returns {string[]}
 */
const asTopicNames = (value) => {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (name) =>
      typeof name === 'string' && name.length > 0 && name.length <= maxTopicLength,
  );
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
    if (!message || typeof message.type !== 'string' || closed) return;

    // A throw here would reach `ws`'s emit with no handler above it and take
    // the whole process down, dropping every peer in every room. One
    // malformed-but-parseable frame must never do that.
    try {
      switch (message.type) {
        case 'subscribe':
          asTopicNames(message.topics).forEach((topicName) => {
            if (subscribedTopics.size >= maxTopicsPerConnection) return;
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
          asTopicNames(message.topics).forEach((topicName) => {
            subscribedTopics.delete(topicName);
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
          // Only a subscriber of the topic may publish to it. Without this,
          // anyone who learns a room id can inject spoofed WebRTC signaling
          // into a live session without ever joining it.
          if (
            typeof message.topic === 'string' &&
            subscribedTopics.has(message.topic)
          ) {
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
    } catch (error) {
      console.error('[relay] dropped a message that threw:', error?.message);
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
