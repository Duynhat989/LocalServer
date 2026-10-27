const { DataTypes } = require('sequelize');

function defineSession(sequelize) {
  return sequelize.define(
    'Session',
    {
      token: {
        type: DataTypes.TEXT,
        primaryKey: true,
      },
      userId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        field: 'user_id',
      },
      jti: {
        type: DataTypes.STRING(64),
        allowNull: true,
        unique: true,
      },
    },
    {
      tableName: 'sessions',
      timestamps: true,
      createdAt: 'created_at',
      updatedAt: false,
    }
  );
}

module.exports = { defineSession };
