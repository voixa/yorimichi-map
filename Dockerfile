# Static site served by nginx on Cloud Run
FROM nginx:alpine

# Cloud Run sets PORT env var; nginx config must use it
ENV PORT=8080

# Copy static assets
COPY index.html lp.html about.html offline.html og.svg og.png style.css app.js courses.js photos.js manifest.json sw.js sitemap.xml robots.txt /usr/share/nginx/html/

# Custom nginx config that listens on $PORT
COPY nginx.conf /etc/nginx/templates/default.conf.template

# Use envsubst to inject PORT at runtime (nginx alpine supports this via templates dir)
EXPOSE 8080

CMD ["nginx", "-g", "daemon off;"]
