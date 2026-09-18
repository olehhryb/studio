<?php
/**
 * Plugin Name: WP Theme Studio Bridge
 * Description: Lets WP Theme Studio install generated themes, activate them, ensure Contact Form 7 is present, and create CF7 forms with HTML mail.
 * Version: 1.0.0
 * Author: WP Theme Studio
 */

if (!defined('ABSPATH')) {
    exit;
}

add_action('rest_api_init', function () {
    register_rest_route('wtg/v1', '/status', array(
        'methods' => 'GET',
        'callback' => 'wtg_status',
        'permission_callback' => 'wtg_can_manage',
    ));
    register_rest_route('wtg/v1', '/theme', array(
        'methods' => 'POST',
        'callback' => 'wtg_install_theme',
        'permission_callback' => 'wtg_can_manage',
    ));
    register_rest_route('wtg/v1', '/ensure-cf7', array(
        'methods' => 'POST',
        'callback' => 'wtg_ensure_cf7',
        'permission_callback' => 'wtg_can_manage',
    ));
    register_rest_route('wtg/v1', '/cf7', array(
        'methods' => 'POST',
        'callback' => 'wtg_create_cf7',
        'permission_callback' => 'wtg_can_manage',
    ));
});

function wtg_can_manage() {
    return current_user_can('install_themes') || current_user_can('manage_options');
}

function wtg_status() {
    return array(
        'ok' => true,
        'plugin' => 'wtg-bridge',
        'cf7' => is_plugin_active_for_cf7(),
        'stylesheet' => get_stylesheet(),
    );
}

function is_plugin_active_for_cf7() {
    if (!function_exists('is_plugin_active')) {
        require_once ABSPATH . 'wp-admin/includes/plugin.php';
    }
    return is_plugin_active('contact-form-7/wp-contact-form-7.php');
}

function wtg_install_theme(WP_REST_Request $request) {
    require_once ABSPATH . 'wp-admin/includes/file.php';
    require_once ABSPATH . 'wp-admin/includes/class-wp-upgrader.php';
    require_once ABSPATH . 'wp-admin/includes/theme.php';

    $files = $request->get_file_params();
    if (empty($files['file']['tmp_name'])) {
        return new WP_Error('no_file', 'Theme zip is required', array('status' => 400));
    }

    $skin = new Automatic_Upgrader_Skin();
    $upgrader = new Theme_Upgrader($skin);
    $result = $upgrader->install($files['file']['tmp_name']);
    if (is_wp_error($result) || !$result) {
        return new WP_Error('install_failed', 'Theme install failed', array('status' => 500, 'data' => $skin->get_upgrade_messages()));
    }

    $theme = $upgrader->theme_info();
    if ($theme) {
        switch_theme($theme->get_stylesheet());
    }

    return array(
        'ok' => true,
        'stylesheet' => $theme ? $theme->get_stylesheet() : get_stylesheet(),
        'name' => $theme ? $theme->get('Name') : '',
    );
}

function wtg_ensure_cf7() {
    require_once ABSPATH . 'wp-admin/includes/plugin.php';
    require_once ABSPATH . 'wp-admin/includes/file.php';
    require_once ABSPATH . 'wp-admin/includes/class-wp-upgrader.php';
    require_once ABSPATH . 'wp-admin/includes/plugin-install.php';

    if (!is_plugin_active_for_cf7()) {
        $upgrader = new Plugin_Upgrader(new Automatic_Upgrader_Skin());
        $upgrader->install('https://downloads.wordpress.org/plugin/contact-form-7.latest-stable.zip');
        activate_plugin('contact-form-7/wp-contact-form-7.php');
    }

    return array('ok' => true, 'cf7' => is_plugin_active_for_cf7());
}

function wtg_create_cf7(WP_REST_Request $request) {
    if (!class_exists('WPCF7_ContactForm')) {
        return new WP_Error('cf7_missing', 'Contact Form 7 is not active', array('status' => 400));
    }

    $title = sanitize_text_field($request->get_param('title'));
    $form = $request->get_param('form');
    $mail_subject = sanitize_text_field($request->get_param('mailSubject'));
    $mail_recipient = sanitize_email($request->get_param('mailRecipient'));
    $mail_body = $request->get_param('mailBodyHtml');

    $contact_form = WPCF7_ContactForm::get_template(array('title' => $title));
    $properties = $contact_form->get_properties();
    $properties['form'] = is_string($form) ? $form : '';
    $properties['mail']['subject'] = $mail_subject;
    $properties['mail']['recipient'] = $mail_recipient;
    $properties['mail']['body'] = is_string($mail_body) ? $mail_body : '';
    $properties['mail']['use_html'] = true;
    $properties['mail']['sender'] = $title . ' <[your-email]>';
    $contact_form->set_properties($properties);
    $contact_form->set_title($title);
    $contact_form->save();

    $id = $contact_form->id();
    return array(
        'ok' => true,
        'id' => $id,
        'shortcode' => '[contact-form-7 id="' . $id . '" title="' . esc_attr($title) . '"]',
    );
}
