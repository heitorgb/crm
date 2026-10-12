# Frontend — build (Vite) + serve estático (nginx) com proxy de /api e /socket.io.
# O VITE_API_BASE_URL deve ficar vazio (mesma origem): o nginx faz o proxy.

FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:1.27-alpine AS runtime
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
