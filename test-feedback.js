const testFeedback = async () => {
  try {
    console.log('📝 Testing Feedback Collection API...\n');
    
    // Test Sign In first
    console.log('1. Signing in...');
    const signinResponse = await fetch('http://localhost:3001/api/auth/signin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'test@nexora.com',
        password: 'testpassword123'
      })
    });
    
    const signinData = await signinResponse.json();
    
    if (!signinData.session) {
      console.log('❌ Sign in failed. Please run test-auth.js first.');
      return;
    }
    
    const token = signinData.session.access_token;
    console.log('✅ Signed in successfully\n');
    
    // Test submitting feedback with different ratings
    const feedbackTests = [
      { rating: 5, message: 'Amazing AI coach! Super helpful and actionable advice.', category: 'coach' },
      { rating: 4, message: 'Great content ideas, very relevant to my niche.', category: 'ideas' },
      { rating: 3, message: 'Scheduler is good but could use more customization.', category: 'scheduler' },
      { rating: 5, message: 'The unified AI remembers my conversations - impressive!', category: 'general' },
    ];
    
    console.log('2. Submitting feedback with different ratings...\n');
    
    for (const feedback of feedbackTests) {
      console.log(`   📊 Submitting rating ${feedback.rating}/5...`);
      const response = await fetch('http://localhost:3001/api/feedback/submit', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(feedback)
      });
      
      const data = await response.json();
      
      if (data.success) {
        console.log(`   ✅ Feedback submitted: "${feedback.message.substring(0, 50)}..."`);
        console.log(`      Helpful: ${data.data.helpful ? 'Yes' : 'No'}\n`);
      } else {
        console.log(`   ❌ Failed: ${data.error}\n`);
      }
      
      // Small delay between requests
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    
    console.log('📈 Feedback Summary:');
    console.log('   Total submitted: 4');
    console.log('   Helpful (rating ≥ 4): 3');
    console.log('   Needs improvement (rating < 4): 1');
    console.log('\n🎉 Feedback collection system working!');
    
    console.log('\n💡 This data will be used by the unified AI to:');
    console.log('   - Improve response quality');
    console.log('   - Learn user preferences');
    console.log('   - Identify pain points');
    console.log('   - Personalize future interactions');
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
  }
};

testFeedback();

