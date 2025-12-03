import React from 'react';
import {TouchableOpacity, Text, View, StyleSheet} from 'react-native';
import {LinearGradient} from 'expo-linear-gradient';
import colors from '../styles/colors';

const MenuButton = ({icon, title, color1, color2, onPress, badge}) => {
  return (
    <TouchableOpacity 
      style={styles.menuItem} 
      onPress={onPress}
      activeOpacity={0.8}>
      <LinearGradient
        colors={[color1, color2]}
        start={{x: 0, y: 0}}
        end={{x: 1, y: 1}}
        style={styles.menuButton}>
        <Text style={styles.menuIcon}>{icon}</Text>
        {badge && (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{badge}</Text>
          </View>
        )}
      </LinearGradient>
      <Text style={styles.menuTitle}>{title}</Text>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  menuItem: {
    width: '48%',
    marginBottom: 20,
    alignItems: 'center',
  },
  
  menuButton: {
    width: '100%',
    aspectRatio: 1,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: {width: 0, height: 4},
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 5,
    position: 'relative',
  },
  
  menuIcon: {
    fontSize: 48,
  },
  
  badge: {
    position: 'absolute',
    top: 10,
    right: 10,
    backgroundColor: colors.danger,
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 2,
    minWidth: 24,
    alignItems: 'center',
  },
  
  badgeText: {
    color: colors.white,
    fontSize: 12,
    fontWeight: 'bold',
  },
  
  menuTitle: {
    marginTop: 10,
    fontSize: 14,
    fontWeight: '600',
    color: colors.textPrimary,
    textAlign: 'center',
  },
});

export default MenuButton;

