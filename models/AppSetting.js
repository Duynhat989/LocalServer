const { DataTypes } = require('sequelize');

function defineAppSetting(sequelize) {
  return sequelize.define(
    'AppSetting',
    {
      key: {
        type: DataTypes.STRING(64),
        primaryKey: true,
      },
      value: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
    },
    {
      tableName: 'app_settings',
      timestamps: true,
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    }
  );
}

module.exports = { defineAppSetting };
