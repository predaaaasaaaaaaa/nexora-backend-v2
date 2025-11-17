// User data model
export class User {
  constructor(data) {
    this.id = data.id;
    this.email = data.email;
    this.username = data.username;
    this.platforms = data.platforms || [];
    this.preferences = data.preferences || {};
    this.createdAt = data.createdAt || new Date();
    this.updatedAt = data.updatedAt || new Date();
  }

  // TODO: Add user validation methods
  validate() {
    // TODO: Implement user validation
    return { valid: true, errors: [] };
  }

  // TODO: Add user serialization methods
  toJSON() {
    return {
      id: this.id,
      email: this.email,
      username: this.username,
      platforms: this.platforms,
      preferences: this.preferences,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt
    };
  }
}




