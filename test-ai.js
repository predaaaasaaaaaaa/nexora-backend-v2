const testAI = async () => {
  try {
    const response = await fetch('http://localhost:3001/api/coach/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: "My Instagram Reels are getting way less views than before. What should I do?",
        platform: "instagram",
        niche: "fitness"
      })
    });
    
    const data = await response.json();
    console.log('\n🤖 AI COACH RESPONSE:\n');
    console.log(data.message);
    console.log('\n---\n');
  } catch (error) {
    console.error('❌ Error:', error);
  }
};

testAI();

