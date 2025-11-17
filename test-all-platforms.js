const testAllPlatforms = async () => {
  try {
    console.log('🧪 Testing All 4 Platforms (Instagram, YouTube, TikTok, Twitter)...\n');
    
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
      console.log('❌ Sign in failed. Please run test-auth.js first to create an account.');
      return;
    }
    
    const token = signinData.session.access_token;
    console.log('✅ Signed in successfully\n');
    
    // Test each platform's analytics
    const platforms = ['instagram', 'youtube', 'tiktok', 'twitter'];
    
    for (const platform of platforms) {
      console.log(`📊 Testing ${platform.toUpperCase()} analytics...`);
      const response = await fetch(`http://localhost:3001/api/analytics/${platform}`, {
        method: 'GET',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        }
      });
      
      const data = await response.json();
      
      if (data.success) {
        console.log(`✅ ${platform}: ${data.data.followers || data.data.subscribers} followers/subscribers`);
        console.log(`   Posts: ${data.data.posts?.length || data.data.videos?.length || data.data.tweets?.length}`);
        console.log(`   Avg Engagement: ${data.data.insights.avgEngagementRate}%\n`);
      } else {
        console.log(`❌ ${platform} failed:`, data.error, '\n');
      }
    }
    
    // Test combined analytics
    console.log('📈 Testing COMBINED analytics...');
    const combinedResponse = await fetch('http://localhost:3001/api/analytics/combined', {
      method: 'GET',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      }
    });
    
    const combinedData = await combinedResponse.json();
    
    if (combinedData.success) {
      console.log('✅ Combined Analytics:');
      console.log(`   Total Followers: ${combinedData.data.totalFollowers.toLocaleString()}`);
      console.log(`   Total Posts: ${combinedData.data.totalPosts}`);
      console.log(`   Avg Engagement: ${combinedData.data.avgEngagement}%\n`);
    }
    
    // Test AI Coach for each platform
    console.log('🤖 Testing AI Coach for each platform...\n');
    
    const testQuestions = {
      instagram: "My Instagram Reels aren't getting views. What should I do?",
      youtube: "How can I improve my YouTube Shorts performance?",
      tiktok: "My TikTok videos are stuck at 200 views. Help!",
      twitter: "How do I make my tweets go viral?"
    };
    
    for (const [platform, question] of Object.entries(testQuestions)) {
      console.log(`💬 ${platform.toUpperCase()}: "${question}"`);
      const coachResponse = await fetch('http://localhost:3001/api/coach/chat', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          message: question,
          platform: platform
        })
      });
      
      const coachData = await coachResponse.json();
      
      if (coachData.success) {
        console.log(`✅ AI Response: ${coachData.message.substring(0, 150)}...\n`);
      } else {
        console.log(`❌ Failed: ${coachData.error}\n`);
      }
    }
    
    console.log('🎉 All platform tests completed!');
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
  }
};

testAllPlatforms();

