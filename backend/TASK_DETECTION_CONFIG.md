# 🚀 Smart Task Detection Configuration

## **Overview**
The new AI-powered task detection system automatically identifies tasks from natural language conversations, making it much easier to capture actionable items without manual intervention.

## **Environment Variables**

### **Enable/Disable Smart Detection**
```bash
# Enable smart task detection (default: true)
SMART_TASK_DETECTION=true

# Disable smart task detection
SMART_TASK_DETECTION=false
```

### **Debug Logging**
```bash
# Enable debug logging for task detection
TASK_DETECTION_DEBUG=true

# Disable debug logging (default: false)
TASK_DETECTION_DEBUG=false
```

## **How It Works**

### **1. Explicit Task Detection**
Catches clear task indicators:
- `task: buy groceries`
- `todo: call mom`
- `remind me to check email`
- `i need to finish the report`
- `don't forget to send invoice`

### **2. AI-Powered Implicit Detection**
Uses Cerebras model to understand context:
- **Problem statements**: "I'm having trouble with the login system" → "Fix login system issues"
- **Future actions**: "I should review the quarterly reports" → "Review quarterly reports"
- **Goals**: "I want to improve the user interface" → "Improve user interface"
- **Responsibilities**: "The database needs maintenance" → "Maintain database"

### **3. Fallback Pattern Matching**
If AI detection fails, falls back to regex patterns:
- `fix the login system`
- `review quarterly reports`
- `update documentation`

## **Testing**

### **Test Endpoint**
```bash
curl -X POST "http://localhost:8000/test/task-detection" \
  -F "message=I need to fix the login system issues"
```

### **Response Format**
```json
{
  "message": "I need to fix the login system issues",
  "detected_task": "Fix login system issues",
  "is_task": true,
  "smart_detection_enabled": true
}
```

## **Examples**

### **✅ Will Detect Tasks:**
- "I'm having trouble with the login system"
- "The quarterly reports need review"
- "I should call the client tomorrow"
- "Don't forget to backup the database"
- "The user interface could use improvement"
- "We need to schedule a team meeting"

### **❌ Won't Detect Tasks:**
- "Hello, how are you?"
- "The weather is nice today"
- "Can you explain this code?"
- "What's the capital of France?"

## **Performance**

- **Fast**: Explicit patterns detected instantly
- **Smart**: AI detection takes ~100-200ms
- **Fallback**: Regex patterns if AI fails
- **Configurable**: Can be disabled for performance

## **Memory Usage**

- **Lightweight**: Uses existing Cerebras model
- **Efficient**: Only processes messages >10 characters
- **Cached**: Model stays loaded between requests

## **Troubleshooting**

### **Tasks Not Being Detected**
1. Check `SMART_TASK_DETECTION` environment variable
2. Enable `TASK_DETECTION_DEBUG=true` for logging
3. Verify message length >10 characters
4. Check if message contains actionable content

### **Performance Issues**
1. Disable with `SMART_TASK_DETECTION=false`
2. Use only explicit patterns (faster)
3. Check memory usage with `/memory` endpoint

### **False Positives**
1. Review detected tasks in logs
2. Adjust AI prompt if needed
3. Add specific exclusions to patterns
