#!/bin/bash

COMMAND=$1
BATCH_NAME=$2

function fetch_and_merge() {
    if [ -z "$BATCH_NAME" ]; then
        echo "❌ Error: BATCH_NAME missing!"
        echo "Usage: ./manager.sh $COMMAND <BATCH_NAME>"
        exit 1
    fi

    BATCH_PATH="./results/$BATCH_NAME"
    MASTER_FILE="$BATCH_PATH/Master_Dataset_${BATCH_NAME}.json"

    if [ ! -d "$BATCH_PATH" ]; then
        echo "❌ Directory $BATCH_PATH nahi mili!"
        exit 1
    fi

    echo "📊 Merging available Pod data in $BATCH_PATH..."
    
    if ls $BATCH_PATH/Dataset_Pod_*.json 1> /dev/null 2>&1; then
        jq -s 'flatten' $BATCH_PATH/Dataset_Pod_*.json > $MASTER_FILE
        TOTAL_POSTS=$(jq 'length' $MASTER_FILE)
        echo "✅ Master File Updated: $MASTER_FILE | Total: $TOTAL_POSTS Posts."
        echo "--------------------------------------------------"
        jq -r '.[] | "Post: \(.shortcode) | Comments: \(.commentsRawData | length)"' $MASTER_FILE
        echo "--------------------------------------------------"
    else
        echo "⚠️ Abhi tak koi data files create nahi huin."
    fi
}

if [ "$COMMAND" == "preview" ]; then
    fetch_and_merge
elif [ "$COMMAND" == "finalize" ]; then
    fetch_and_merge
    echo "☁️ Uploading entire Batch folder to MEGA..."
    rclone config create vfx mega user "enragedoatmeal6@sharebot.net" pass "zEUj2zsBGHxy" --non-interactive > /dev/null 2>&1
    rclone copy $BATCH_PATH vfx:Instagram_Data/Batch_${BATCH_NAME}/ --progress
    echo "✅ MEGA UPLOAD DONE!"
elif [ "$COMMAND" == "stop" ]; then
    echo "💀 Killing Kubernetes Job..."
    kubectl delete job ig-scraper -n scraper
    echo "✅ Stopped."
else
    echo "Usage: ./manager.sh [preview | finalize | stop] <BATCH_NAME>"
fi