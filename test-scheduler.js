const testScheduler = async () => {
  try {
    console.log('📅 Testing AI-Powered Auto-Scheduler...\n');
    
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
    
    // Test optimal schedule for each platform
    const platforms = ['instagram', 'youtube', 'tiktok', 'twitter'];
    
    for (const platform of platforms) {
      console.log(`\n⏰ Getting optimal schedule for ${platform.toUpperCase()}...`);
      const response = await fetch(`http://localhost:3001/api/scheduler/${platform}`, {
        method: 'GET',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        }
      });
      
      const data = await response.json();
      
      if (data.success) {
        console.log(`✅ ${platform.toUpperCase()} Schedule:`);
        console.log(`   Best Time Slot: ${data.analysis.bestTimeSlot} (${data.analysis.bestTimeSlotEngagement}% engagement)`);
        console.log(`   Optimal Times: ${data.optimalTimes.join(', ')}`);
        console.log(`   Best Days: ${data.optimalDays.map(d => `${d.day} (${d.avgEngagement}%)`).join(', ')}`);
        console.log(`   Current Frequency: ${data.analysis.currentPostingFrequency}`);
        console.log(`\n   🤖 AI Recommendations:`);
        console.log(`   ${data.recommendations.substring(0, 200)}...\n`);
      } else {
        console.log(`❌ ${platform} failed:`, data.error);
      }
    }
    
    // Test combined schedule for all platforms
    console.log('\n📊 Getting COMBINED schedule for all platforms...');
    const allSchedulesResponse = await fetch('http://localhost:3001/api/scheduler/all', {
      method: 'GET',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      }
    });
    
    const allSchedulesData = await allSchedulesResponse.json();
    
    if (allSchedulesData.success) {
      console.log('✅ Combined Schedule Summary:');
      console.log(`   Total Optimal Time Slots: ${allSchedulesData.summary.totalOptimalSlots}`);
      console.log(`   Best Performing Platform: ${allSchedulesData.summary.bestPerformingPlatform}`);
      console.log(`   Best Engagement Rate: ${allSchedulesData.summary.bestEngagementRate}\n`);
      
      console.log('📅 Full Schedule Matrix:');
      Object.entries(allSchedulesData.schedules).forEach(([platform, schedule]) => {
        console.log(`\n   ${platform.toUpperCase()}:`);
        console.log(`     Times: ${schedule.optimalTimes.join(', ')}`);
        console.log(`     Days: ${schedule.optimalDays.map(d => d.day).join(', ')}`);
      });
    }
    
    console.log('\n🎉 Scheduler tests completed!');
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
  }
};

testScheduler();

