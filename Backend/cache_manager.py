"""CSV-based cache manager for market data"""
import os
import json
import pandas as pd
from datetime import datetime, timedelta
import threading

# Cache directory
CACHE_DIR = os.path.join(os.path.dirname(__file__), 'data_cache')
# On Render, filesystem is ephemeral, so we extend cache validity to reduce API calls
# Cache will be used if it exists and is less than 7 days old
DATA_UPDATE_INTERVAL = timedelta(days=7)  # Update data every 7 days (extended for Render)

# Ensure cache directory exists
os.makedirs(CACHE_DIR, exist_ok=True)

cache_lock = threading.Lock()

def get_cache_path(data_type):
    """Get the path to the CSV cache file for a data type"""
    return os.path.join(CACHE_DIR, f'{data_type}.json')

def get_timestamp_path(data_type):
    """Get the path to the timestamp file for a data type"""
    return os.path.join(CACHE_DIR, f'{data_type}_timestamp.txt')

def is_cache_valid(data_type):
    """Check if cache exists and is less than 3 days old"""
    timestamp_path = get_timestamp_path(data_type)
    cache_path = get_cache_path(data_type)
    
    # Check if cache files exist
    if not os.path.exists(cache_path) or not os.path.exists(timestamp_path):
        return False
    
    try:
        # Read timestamp
        with open(timestamp_path, 'r') as f:
            timestamp_str = f.read().strip()
            last_update = datetime.fromisoformat(timestamp_str)
        
        # Check if data is older than 3 days
        age = datetime.now() - last_update
        return age < DATA_UPDATE_INTERVAL
    except Exception as e:
        print(f"Error checking cache validity for {data_type}: {e}")
        return False

def load_from_cache(data_type):
    """Load data from CSV/JSON cache"""
    cache_path = get_cache_path(data_type)
    
    if not os.path.exists(cache_path):
        return None
    
    try:
        with open(cache_path, 'r') as f:
            data = json.load(f)
        print(f"Loaded {data_type} from cache")
        return data
    except Exception as e:
        print(f"Error loading cache for {data_type}: {e}")
        return None

def save_to_cache(data_type, data, data_changed=False):
    """Save data to CSV/JSON cache"""
    cache_path = get_cache_path(data_type)
    timestamp_path = get_timestamp_path(data_type)
    
    try:
        with cache_lock:
            # Save data as JSON
            with open(cache_path, 'w') as f:
                json.dump(data, f, indent=2, default=str)
            
            # Save timestamp
            with open(timestamp_path, 'w') as f:
                f.write(datetime.now().isoformat())
            
            # If data changed, create/update a data_changed flag file
            if data_changed:
                changed_flag_path = os.path.join(CACHE_DIR, f'{data_type}_changed.txt')
                with open(changed_flag_path, 'w') as f:
                    f.write(datetime.now().isoformat())
        
        print(f"Saved {data_type} to cache")
        return True
    except Exception as e:
        print(f"Error saving cache for {data_type}: {e}")
        return False

def clear_data_changed_flag(data_type):
    """Clear the data_changed flag for a data type"""
    changed_flag_path = os.path.join(CACHE_DIR, f'{data_type}_changed.txt')
    try:
        if os.path.exists(changed_flag_path):
            os.remove(changed_flag_path)
    except Exception as e:
        print(f"Error clearing changed flag for {data_type}: {e}")

def check_data_changed(data_type):
    """Check if data was changed since last check"""
    changed_flag_path = os.path.join(CACHE_DIR, f'{data_type}_changed.txt')
    if os.path.exists(changed_flag_path):
        try:
            with open(changed_flag_path, 'r') as f:
                timestamp_str = f.read().strip()
                return timestamp_str
        except:
            return None
    return None

def get_cache_age(data_type):
    """Get the age of cached data in days"""
    timestamp_path = get_timestamp_path(data_type)
    
    if not os.path.exists(timestamp_path):
        return None
    
    try:
        with open(timestamp_path, 'r') as f:
            timestamp_str = f.read().strip()
            last_update = datetime.fromisoformat(timestamp_str)
        
        age = datetime.now() - last_update
        return age.days
    except Exception as e:
        print(f"Error getting cache age for {data_type}: {e}")
        return None

def clear_cache(data_type=None):
    """Clear cache for a specific data type or all caches"""
    if data_type:
        cache_path = get_cache_path(data_type)
        timestamp_path = get_timestamp_path(data_type)
        
        try:
            if os.path.exists(cache_path):
                os.remove(cache_path)
            if os.path.exists(timestamp_path):
                os.remove(timestamp_path)
            print(f"Cleared cache for {data_type}")
        except Exception as e:
            print(f"Error clearing cache for {data_type}: {e}")
    else:
        # Clear all caches
        for file in os.listdir(CACHE_DIR):
            file_path = os.path.join(CACHE_DIR, file)
            try:
                if os.path.isfile(file_path):
                    os.remove(file_path)
            except Exception as e:
                print(f"Error removing {file_path}: {e}")
        print("Cleared all caches")
