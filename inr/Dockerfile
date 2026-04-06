FROM node:20-alpine
RUN apk add --no-cache curl bash sudo unzip rclone
WORKDIR /app
COPY package.json ./
RUN npm install
COPY . .
RUN mkdir -p /data/output
CMD ["node", "scraper.js"]
