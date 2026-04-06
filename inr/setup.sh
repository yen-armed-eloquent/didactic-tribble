# ... (Baqi steps same hain) ...

echo "🚀 Step 4: Building & Deploying..."
docker build -t k3d-registry.localhost:5111/ig-scraper:v1 .
docker push k3d-registry.localhost:5111/ig-scraper:v1

# Yahan ACCOUNTS_JSON ko environment mein pass karna zaroori hai (yml handles this)
kubectl apply -f job.yml

echo "⏳ Step 5: Streaming Live Logs from Pods..."
sleep 10
# Detailed Screen Tracking
kubectl logs -n scraper -l app=ig-scraper -f --prefix=true --all-containers=true
