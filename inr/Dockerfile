FROM node:20-alpine

# Rclone, unzip aur baqi zaroori tools install karna
RUN apk add --no-cache curl bash sudo unzip rclone

# Working directory set karna
WORKDIR /app

# Sirf package.json pehle copy kar rahe hain (wildcard * hata diya hai)
COPY package.json ./

# Dependencies (jaise axios) install karna
RUN npm install

# Ab baqi saari files (scraper.js, scripts, waghera) copy hongi
COPY . .

# Results save karne ke liye output directory banana
RUN mkdir -p /data/output

# Jab container start ho toh scraper chalana
CMD ["node", "scraper.js"]
