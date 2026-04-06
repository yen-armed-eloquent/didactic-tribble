#!/bin/bash
COMMAND=$1
BATCH_NAME=$2

function fetch_and_merge() {
    BATCH_PATH="./results/$BATCH_NAME"
    MASTER_FILE="$BATCH_PATH/Master_Dataset_${BATCH_NAME}.json"

    echo "📊 Merging available Pod data in $BATCH_PATH..."
    if ls $BATCH_PATH/Dataset_Pod_*.json 1> /dev/null 2>&1; then
        jq -s 'flatten' $BATCH_PATH/Dataset_Pod_*.json > $MASTER_FILE
        TOTAL_POSTS=$(jq 'length' $MASTER_FILE)
        echo "✅ Master File Created: $MASTER_FILE | Total: $TOTAL_POSTS Posts."
    else
        echo "⚠️ No data files found."
    fi
}

if [ "$COMMAND" == "finalize" ]; then
    fetch_and_merge
    echo "☁️ Uploading entire Batch folder to MEGA..."
    # Secrets ka use
    rclone config create vfx mega user "$MEGA_USER" pass "$MEGA_PASS" --non-interactive > /dev/null 2>&1
    rclone copy $BATCH_PATH vfx:Instagram_Data/Batch_${BATCH_NAME}/ --progress
    echo "✅ MEGA UPLOAD DONE!"
fi
