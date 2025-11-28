FROM node:20-alpine
USER node

# Set working directory inside container
WORKDIR /home/node/app
COPY --chown=node:node package*.json ./
RUN npm install --only=production
COPY --chown=node:node . .

EXPOSE 3000
# Define command to run your app
CMD ["node", "server.js"]
