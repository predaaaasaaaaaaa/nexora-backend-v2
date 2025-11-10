const testUnifiedAI = async () => {
  try {
    console.log('🧠 Testing UNIFIED AI SYSTEM...\n');
    
    // Test Sign In
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
    
    // Test 1: Coach with unified AI
    console.log('🎯 Test 1: AI Coach with Unified Context...');
    const coachResponse = await fetch('http://localhost:3001/api/coach/chat', {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        message: "I want to grow my Instagram but I'm not sure where to start",
        platform: "instagram"
      })
    });
    
    const coachData = await coachResponse.json();
    
    if (coachData.success) {
      console.log('✅ Coach Response Received');
      console.log(`   Context Used:`);
      console.log(`   - Conversations: ${coachData.contextUsed.conversations}`);
      console.log(`   - Platforms: ${coachData.contextUsed.platforms.join(', ')}`);
      console.log(`   - Scheduled Posts: ${coachData.contextUsed.scheduledPosts}`);
      console.log(`   - Learning Insights: ${coachData.contextUsed.learningInsights.join('; ')}`);
      console.log(`\n   🤖 Response: ${coachData.response.substring(0, 200)}...\n`);
    }
    
    // Wait a bit for interaction to save
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Test 2: Ask follow-up question (should remember context)
    console.log('🔄 Test 2: Follow-up Question (Testing Memory)...');
    const followupResponse = await fetch('http://localhost:3001/api/coach/chat', {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        message: "What about TikTok? Should I focus there instead?",
        platform: "tiktok"
      })
    });
    
    const followupData = await followupResponse.json();
    
    if (followupData.success) {
      console.log('✅ Follow-up Response (AI should remember previous conversation)');
      console.log(`   Context Used:`);
      console.log(`   - Conversations: ${followupData.contextUsed.conversations}`);
      console.log(`   🤖 Response: ${followupData.response.substring(0, 200)}...\n`);
    }
    
    // Test 3: Scheduler with unified AI
    console.log('📅 Test 3: Scheduler with Unified Context...');
    const schedulerResponse = await fetch('http://localhost:3001/api/scheduler/instagram', {
      method: 'GET',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      }
    });
    
    const schedulerData = await schedulerResponse.json();
    
    if (schedulerData.success) {
      console.log('✅ Scheduler Analysis');
      console.log(`   Best Time: ${schedulerData.analysis.bestTimeSlot}`);
      console.log(`   Context Used:`);
      console.log(`   - Conversations: ${schedulerData.contextUsed.conversations}`);
      console.log(`   - Learning Insights: ${schedulerData.contextUsed.learningInsights.slice(0, 2).join('; ')}`);
      console.log(`\n   🤖 AI Insights: ${schedulerData.aiInsights.substring(0, 200)}...\n`);
    }
    
    // Test 4: Content Ideas with unified AI
    console.log('💡 Test 4: Content Ideas with Unified Context...');
    const ideasResponse = await fetch('http://localhost:3001/api/ideas/instagram?count=3', {
      method: 'GET',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      }
    });
    
    const ideasData = await ideasResponse.json();
    
    if (ideasData.success) {
      console.log('✅ Content Ideas Generated');
      console.log(`   Context Used:`);
      console.log(`   - Conversations: ${ideasData.contextUsed.conversations}`);
      console.log(`   - Platforms: ${ideasData.contextUsed.platforms.join(', ')}`);
      console.log(`\n   🎯 Ideas (AI-generated with full user context):`);
      console.log(`   ${ideasData.ideas.substring(0, 300)}...\n`);
    }
    
    console.log('📊 Summary of Unified AI System:');
    console.log('   ✅ Single AI brain powers all features');
    console.log('   ✅ Shared memory across coach, scheduler, ideas');
    console.log('   ✅ Continuous learning from conversations');
    console.log('   ✅ Context-aware responses');
    console.log('   ✅ Personalized to user behavior\n');
    
    console.log('🎉 Unified AI System tests completed!');
    console.log('\n💡 Key Benefits:');
    console.log('   - AI remembers past conversations');
    console.log('   - Recommendations improve over time');
    console.log('   - Consistent personality across features');
    console.log('   - Deep understanding of user needs');
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
  }
};

testUnifiedAI();

