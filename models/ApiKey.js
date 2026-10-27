const { DataTypes } = require('sequelize');

function defineApiKey(sequelize) {
  return sequelize.define(
    'ApiKey',
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      userId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        field: 'user_id',
      },
      name: {
        type: DataTypes.STRING(120),
        allowNull: false,
        defaultValue: 'API Key',
      },
      key: {
        type: DataTypes.TEXT,
        allowNull: false,
        unique: true,
      },
      keyPrefix: {
        type: DataTypes.STRING(24),
        allowNull: false,
        field: 'key_prefix',
      },
      lastUsedAt: {
        type: DataTypes.DATE,
        allowNull: true,
        field: 'last_used_at',
      },
    },
    {
      tableName: 'api_keys',
      timestamps: true,
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    }
  );
}

module.exports = { defineApiKey };
