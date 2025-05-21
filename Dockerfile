# Use official Node.js image as the build stage
FROM node:20 AS build

# Set working directory
WORKDIR /app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm install

# Copy the rest of the application
COPY . .

# Build the React app for production
RUN npm run build

# Use official Nginx image to serve the static build
FROM nginx:alpine

# Copy build output to Nginx's public directory
COPY --from=build /app/dist /usr/share/nginx/html


# Replace default Nginx config to listen on port 8080
RUN sed -i 's/80/8080/' /etc/nginx/conf.d/default.conf

# Expose port
EXPOSE 8080

# Start Nginx server
CMD ["nginx", "-g", "daemon off;"]