const testContentGenerator = async () => {
  try {
    console.log('💡 Testing AI Content Generator...\n');
    
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
    
    // Test content generation for each platform
    const platforms = ['instagram', 'youtube', 'tiktok', 'twitter'];
    
    for (const platform of platforms) {
      console.log(`\n💡 Generating content ideas for ${platform.toUpperCase()}...`);
      const response = await fetch(`http://localhost:3001/api/ideas/${platform}?count=5`, {
        method: 'GET',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        }
      });
      
      const data = await response.json();
      
      if (data.success) {
        console.log(`✅ ${platform.toUpperCase()} Ideas Generated:`);
        console.log(`   Analysis:`);
        console.log(`   - Top Post Types: ${data.analysis.patterns.topPostTypes.map(t => t.type).join(', ')}`);
        console.log(`   - Top 5 Avg Engagement: ${data.analysis.patterns.avgEngagementTop5}%`);
        console.log(`   - Overall Avg Engagement: ${data.analysis.patterns.avgEngagementOverall}%`);
        console.log(`   - Engagement Drivers: ${data.analysis.patterns.engagementDrivers.join(', ')}`);
        
        console.log(`\n   🎯 Generated Ideas:`);
        data.ideas.slice(0, 3).forEach(idea => {
          console.log(`\n   ${idea.id}. ${idea.title}`);
          console.log(`      Format: ${idea.format}`);
          console.log(`      Why: ${idea.reasoning.substring(0, 80)}...`);
          console.log(`      Expected: ${idea.expectedEngagement}`);
        });
        
        console.log(`\n   ... and ${data.ideas.length - 3} more ideas\n`);
      } else {
        console.log(`❌ ${platform} failed:`, data.error);
      }
    }
    
    // Test generating ideas for all platforms at once
    console.log('\n📚 Generating ideas for ALL platforms at once...');
    const allIdeasResponse = await fetch('http://localhost:3001/api/ideas/all?count=3', {
      method: 'GET',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      }
    });
    
    const allIdeasData = await allIdeasResponse.json();
    
    if (allIdeasData.success) {
      console.log('✅ All Platform Ideas Generated:');
      console.log(`   Total Ideas: ${allIdeasData.totalIdeas}`);
      console.log(`   Generated At: ${new Date(allIdeasData.generatedAt).toLocaleString()}\n`);
      
      console.log('   📊 Summary by Platform:');
      Object.entries(allIdeasData.platforms).forEach(([platform, data]) => {
        console.log(`\n   ${platform.toUpperCase()}:`);
        console.log(`     Ideas: ${data.ideas.length}`);
        console.log(`     Best Engagement: ${data.analysis.patterns.avgEngagementTop5}%`);
        console.log(`     Sample Idea: "${data.ideas[0].title.substring(0, 60)}..."`);
      });
    }
    
    console.log('\n🎉 Content generator tests completed!');
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
  }
};

testContentGenerator();

