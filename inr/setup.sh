#!/bin/bash
set -e

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

echo "🏗️ Step 3: Creating Cluster..."
k3d registry create registry.localhost --port 5111
k3d cluster create insta-cluster --agents 0 \
  -v $(pwd)/results:/data/output@all \
  --registry-use k3d-registry.localhost:5111

echo "🚀 Step 4: Building & Deploying..."
docker build -t k3d-registry.localhost:5111/ig-scraper:v1 .
docker push k3d-registry.localhost:5111/ig-scraper:v1

sed -i "s|value: \"BATCH_PLACEHOLDER\"|value: \"$BATCH_NAME\"|g" job.yml
kubectl create namespace scraper --dry-run=client -o yaml | kubectl apply -f -
kubectl create configmap scraper-links --from-file=links.txt=links.txt -n scraper --dry-run=client -o yaml | kubectl apply -f -
kubectl apply -f job.yml
sed -i "s|value: \"$BATCH_NAME\"|value: \"BATCH_PLACEHOLDER\"|g" job.yml

echo "⏳ Step 5: Streaming Live Logs from Pods..."
# Thora wait kar rahe hain taake pods start ho jayein
sleep 10
# Ye line aapki screen par har pod ka live progress dikhayegi (ex: 45/100, Retry 2/10)
kubectl logs -n scraper -l app=ig-scraper -f --prefix=true --all-containers=true
