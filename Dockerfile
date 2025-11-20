FROM node:18.20-slim
WORKDIR /app
COPY . .
RUN npm install --production --verbose
EXPOSE 3000
CMD ["node", "server/app.js"]