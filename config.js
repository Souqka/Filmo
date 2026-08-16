/**
 * Конфигурация приложения «Слот-машина фильмов».
 * Получите бесплатный API-ключ: https://www.themoviedb.org/settings/api
 */
const CONFIG = {
    TMDB_API_KEY: 'YOUR_API_KEY_HERE', // Замените на реальный ключ
    TMDB_BASE_URL: 'https://api.themoviedb.org/3',
    TMDB_IMAGE_BASE: 'https://image.tmdb.org/t/p/w500',
    TMDB_IMAGE_SMALL: 'https://image.tmdb.org/t/p/w92',
    DEFAULT_LANGUAGE: 'ru-RU',
    SECONDARY_LANGUAGE: 'en-US',
    MAX_RESULTS: 10,
    SPIN_DURATION: 5000, // мс
    REEL_ITEM_HEIGHT: 400, // px
    MIN_MOVIES_REQUIRED: 2,
    SEARCH_DEBOUNCE: 500,
    MIN_QUERY_LENGTH: 2,
    ANIMATION_GENRE_ID: 16,
    STORAGE_KEY: 'filmo_movies',
    SETTINGS_KEY: 'filmo_settings',
    PLACEHOLDER_IMAGE: './assets/placeholder.svg',
    SPIN_SPEEDS: {
        fast: 4000,
        medium: 5000,
        slow: 6000
    }
};
