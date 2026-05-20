FROM node:18-alpine
WORKDIR /app
COPY package.json .
COPY server.js .
COPY index.html .
COPY sitemap.xml .
COPY robots.txt .
EXPOSE 3000
CMD ["node", "server.js"]
