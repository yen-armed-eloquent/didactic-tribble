#!/bin/bash
COMMAND=$1
BATCH_NAME=$2

function fetch_and_merge() {
    if [ -z "$BATCH_NAME" ]; then
        echo "❌ Error: BATCH_NAME missing!"
        exit 1
    fi

    BATCH_PATH="./results/$BATCH_NAME"
    MASTER_FILE="$BATCH_PATH/Master_Dataset_${BATCH_NAME}.json"

    if [ ! -d "$BATCH_PATH" ]; then
        echo "❌ Directory $BATCH_PATH nahi mili!"
        exit 1
    fi

    echo "📊 Merging available Pod data in $BATCH_PATH..."
    
    # Tamam Pods ki files ko check karna
    if ls $BATCH_PATH/Dataset_Pod_*.json 1> /dev/null 2>&1; then
        # jq ke zariye saari files ko merge karke ek array banana
        jq -s 'flatten' $BATCH_PATH/Dataset_Pod_*.json > $MASTER_FILE
        TOTAL_POSTS=$(jq 'length' $MASTER_FILE)
        
        echo "✅ Master File Created: $MASTER_FILE"
        echo "📈 Total Posts Processed: $TOTAL_POSTS"
        echo "--------------------------------------------------"
        # Har post ke shortcode aur comments ki counting dikhana
        jq -r '.[] | "Post: \(.shortcode) | Comments: \(.commentsRawData | length)"' $MASTER_FILE
        echo "--------------------------------------------------"
    else
        echo "⚠️ Abhi tak koi data files (Dataset_Pod_*.json) nahi mili hain."
    fi
}

if [ "$COMMAND" == "preview" ]; then
    fetch_and_merge
elif [ "$COMMAND" == "finalize" ]; then
    fetch_and_merge
    echo "☁️ Uploading entire Batch folder to MEGA..."
    
    # Rclone configuration with Secrets
    rclone config create vfx mega user "$MEGA_USER" pass "$MEGA_PASS" --non-interactive > /dev/null 2>&1
    
    # Data upload karna
    rclone copy $BATCH_PATH vfx:Instagram_Data/Batch_${BATCH_NAME}/ --progress
    
    echo "✅ MEGA UPLOAD DONE!"
else
    echo "Usage: ./manager.sh [preview|finalize] BATCH_NAME"
fi
