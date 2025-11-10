const testAuth = async () => {
  try {
    console.log('🧪 Testing Authentication...\n');
    
    // Test Sign Up
    console.log('1. Testing Sign Up...');
    const signupResponse = await fetch('http://localhost:3001/api/auth/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'test@nexora.com',
        password: 'testpassword123',
        username: 'testuser'
      })
    });
    
    const signupData = await signupResponse.json();
    console.log('Signup result:', signupData);
    
    // Test Sign In
    console.log('\n2. Testing Sign In...');
    const signinResponse = await fetch('http://localhost:3001/api/auth/signin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'test@nexora.com',
        password: 'testpassword123'
      })
    });
    
    const signinData = await signinResponse.json();
    console.log('Signin result:', signinData.success ? '✅ Success!' : '❌ Failed');
    
    if (signinData.session) {
      const token = signinData.session.access_token;
      
      // Test Protected Route (AI Coach with auth)
      console.log('\n3. Testing Protected AI Coach...');
      const coachResponse = await fetch('http://localhost:3001/api/coach/chat', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          message: "How can I improve my Instagram Reels?",
          platform: "instagram"
        })
      });
      
      const coachData = await coachResponse.json();
      console.log('AI Coach response:', coachData.success ? '✅ Success!' : '❌ Failed');
      if (coachData.message) {
        console.log('\n🤖 Coach said:', coachData.message.substring(0, 200) + '...');
      }
    }
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
  }
};

testAuth();

