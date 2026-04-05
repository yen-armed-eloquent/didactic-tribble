FROM node:20-alpine

# Rclone aur unzip install karna zaroori hai
RUN apk add --no-cache curl bash sudo unzip rclone

WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .

# Data directory banana
RUN mkdir -p /data/output

CMD ["node", "scraper.js"]