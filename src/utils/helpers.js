// Helper function to validate email
export function validateEmail(email) {
  // TODO: Implement email validation
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

// Helper function to sanitize input
export function sanitizeInput(input) {
  // TODO: Implement input sanitization
  return input.trim();
}

// Helper function to format response
export function formatResponse(data, success = true, message = null) {
  // TODO: Implement response formatting
  return {
    success,
    data,
    message,
    timestamp: new Date().toISOString()
  };
}

// Helper function to generate unique ID
export function generateId() {
  // TODO: Implement ID generation
  return Math.random().toString(36).substr(2, 9);
}













