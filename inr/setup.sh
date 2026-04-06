#!/bin/bash
set -e

# Environment Variables
export KUBECONFIG=$HOME/.k3d-config.yaml
export BATCH_NAME=$(date +"%Y-%m-%dT%H-%M-%S")

echo "🛠️ Step 1: Rclone & Permissions..."
# Rclone install agar pehle se nahi hai
curl -s https://rclone.org/install.sh | sudo bash || true

# Results directory banana
mkdir -p ./results/$BATCH_NAME
sudo chown -R $USER:$USER ./results && sudo chmod -R 777 ./results

echo "🧹 Step 2: Cleaning old K8s setup..."
# Purana setup saaf karna taake conflict na ho
kubectl delete job ig-scraper -n scraper --ignore-not-found || true
k3d cluster delete insta-cluster || true
k3d registry delete k3d-registry.localhost || true

echo "🏗️ Step 3: Creating Cluster & Registry..."
# Local registry aur k3d cluster banana
k3d registry create registry.localhost --port 5111
k3d cluster create insta-cluster --agents 0 \
  -v $(pwd)/results:/data/output@all \
  --registry-use k3d-registry.localhost:5111

echo "🚀 Step 4: Building & Deploying Image..."
# Docker image build karke local registry mein push karna
docker build -t k3d-registry.localhost:5111/ig-scraper:v1 .
docker push k3d-registry.localhost:5111/ig-scraper:v1

echo "📦 Step 5: Applying K8s Configurations..."
# Namespace aur ConfigMap banana
kubectl create namespace scraper --dry-run=client -o yaml | kubectl apply -f -
kubectl create configmap scraper-links --from-file=links.txt=links.txt -n scraper --dry-run=client -o yaml | kubectl apply -f -

# Job file mein BATCH_NAME inject karna (Temporary file use kar rahe hain)
cp job.yml job_run.yml
sed -i "s|BATCH_PLACEHOLDER|$BATCH_NAME|g" job_run.yml

# Job deploy karna
kubectl apply -f job_run.yml

# Security: ACCOUNTS_JSON ko directly Pods mein inject karna (Secrets handle karne ka sab se safe tareeqa)
echo "🔐 Injecting ACCOUNTS_JSON into Pods..."
kubectl set env job/ig-scraper ACCOUNTS_JSON="$ACCOUNTS_JSON" -n scraper

echo "⏳ Step 6: Streaming Live Logs from Pods..."
# Pods ke start hone ka thora wait
sleep 15

# Live screen tracking (Is se aapko 45/100 aur Retry 2/10 waghaira live nazar aayega)
kubectl logs -n scraper -l app=ig-scraper -f --prefix=true --all-containers=true
