FROM node:24-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --production
COPY server.js ./
EXPOSE 4444
# This process parses untrusted input from the open internet; don't do it as root.
USER node
CMD ["node", "server.js"]
