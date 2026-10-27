const { DataTypes } = require('sequelize');

function defineCampaignPhone(sequelize) {
  return sequelize.define(
    'CampaignPhone',
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      campaignId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        field: 'campaign_id',
      },
      phone: {
        type: DataTypes.STRING(32),
        allowNull: false,
      },
      stepAdd: {
        type: DataTypes.STRING(20),
        allowNull: true,
        field: 'step_add',
      },
      postId: {
        type: DataTypes.STRING(128),
        allowNull: true,
        field: 'post_id',
      },
      postMessage: {
        type: DataTypes.TEXT,
        allowNull: true,
        field: 'post_message',
      },
      postUrl: {
        type: DataTypes.TEXT,
        allowNull: true,
        field: 'post_url',
      },
      groupId: {
        type: DataTypes.STRING(64),
        allowNull: true,
        field: 'group_id',
      },
      groupName: {
        type: DataTypes.STRING(255),
        allowNull: true,
        field: 'group_name',
      },
      fbUserId: {
        type: DataTypes.STRING(64),
        allowNull: true,
        field: 'fb_user_id',
      },
      userName: {
        type: DataTypes.STRING(255),
        allowNull: true,
        field: 'user_name',
      },
      userUrl: {
        type: DataTypes.TEXT,
        allowNull: true,
        field: 'user_url',
      },
      thesame: {
        type: DataTypes.STRING(64),
        allowNull: true,
      },
      createdTime: {
        type: DataTypes.STRING(64),
        allowNull: true,
        field: 'created_time',
      },
      scannedAt: {
        type: DataTypes.BIGINT,
        allowNull: true,
        field: 'scanned_at',
      },
      keyword: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      note: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      isUsed: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
        field: 'is_used',
      },
    },
    {
      tableName: 'campaign_phones',
      timestamps: true,
      createdAt: 'created_at',
      updatedAt: 'updated_at',
      indexes: [
        {
          unique: true,
          fields: ['campaign_id', 'phone'],
          name: 'campaign_phones_campaign_phone_unique',
        },
      ],
    }
  );
}

module.exports = { defineCampaignPhone };
