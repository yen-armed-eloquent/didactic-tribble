#!/bin/bash
set -e

# Environment Variables
export KUBECONFIG=$HOME/.k3d-config.yaml
export BATCH_NAME=$(date +"%Y-%m-%dT%H-%M-%S")

echo "🛠️ Step 1: Rclone & Permissions..."
curl -s https://rclone.org/install.sh | sudo bash || true

mkdir -p ./results/$BATCH_NAME
sudo chown -R $USER:$USER ./results && sudo chmod -R 777 ./results

echo "🧹 Step 2: Cleaning old K8s setup..."
kubectl delete job ig-scraper -n scraper --ignore-not-found || true
k3d cluster delete insta-cluster || true
k3d registry delete k3d-registry.localhost || true

echo "🏗️ Step 3: Creating Cluster & Registry..."
k3d registry create registry.localhost --port 5111
k3d cluster create insta-cluster --agents 0 \
  -v $(pwd)/results:/data/output@all \
  --registry-use k3d-registry.localhost:5111

echo "🚀 Step 4: Building & Deploying Image..."
docker build -t k3d-registry.localhost:5111/ig-scraper:v1 .
docker push k3d-registry.localhost:5111/ig-scraper:v1

echo "📦 Step 5: Applying K8s Configurations..."
kubectl create namespace scraper --dry-run=client -o yaml | kubectl apply -f -
kubectl create configmap scraper-links --from-file=links.txt=links.txt -n scraper --dry-run=client -o yaml | kubectl apply -f -

# 🔐 NAYA STEP: K8s Secret Banana (Job apply karne se pehle)
echo "🔐 Creating Kubernetes Secret for ACCOUNTS_JSON..."
kubectl create secret generic scraper-secrets --from-literal=ACCOUNTS_JSON="$ACCOUNTS_JSON" -n scraper --dry-run=client -o yaml | kubectl apply -f -

# Job file mein BATCH_NAME inject karna
cp job.yml job_run.yml
sed -i "s|BATCH_PLACEHOLDER|$BATCH_NAME|g" job_run.yml

# Job deploy karna
kubectl apply -f job_run.yml

echo "⏳ Step 6: Streaming Live Logs from Pods..."
sleep 15
kubectl logs -n scraper -l app=ig-scraper -f --prefix=true --all-containers=true
